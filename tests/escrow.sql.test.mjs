// Runs supabase-admin-escrow-migration.sql on a real Postgres (PGlite) with a
// minimal stand-in for Supabase's auth schema, then exercises the money flows.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const MIG = new URL('../supabase-admin-escrow-migration.sql', import.meta.url)
const db = new PGlite()

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, last_sign_in_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('email', current_setting('test.email', true)) $$;

  -- tables/functions from the earlier migrations that this one depends on
  CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), full_name text, role text DEFAULT 'user', user_type text,
    kyc_status text DEFAULT 'unverified', address_status text DEFAULT 'unverified', created_at timestamptz DEFAULT now());
  CREATE TABLE jobs (id serial PRIMARY KEY, title text, posted_by uuid, is_active boolean DEFAULT true);
  CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, claimed_by uuid, is_active boolean DEFAULT true);
  CREATE TABLE applications (id serial PRIMARY KEY); CREATE TABLE reviews (id serial PRIMARY KEY);
  CREATE TABLE professionals (id serial PRIMARY KEY); CREATE TABLE company_claims (id serial PRIMARY KEY, status text);
  CREATE TABLE kyc_verifications (id serial PRIMARY KEY, status text, auto_status text, auto_checked_at timestamptz);
  CREATE TABLE job_sync_runs (id serial); CREATE TABLE business_sync_runs (id serial);
  CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') $$;
  CREATE FUNCTION public.is_client_request() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(auth.role(), '') IN ('anon', 'authenticated') $$;
  CREATE FUNCTION public.protect_profile_columns() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER protect_profile_columns BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();
`)

await db.exec(readFileSync(MIG, 'utf8'))
console.log('✔ migration applied cleanly')

const U = { admin: '00000000-0000-0000-0000-00000000000a', client: '00000000-0000-0000-0000-00000000000c', free: '00000000-0000-0000-0000-00000000000f', other: '00000000-0000-0000-0000-0000000000ee' }
for (const [k, id] of Object.entries(U)) await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${k}@test.dev`])
await db.query(`INSERT INTO profiles (id, full_name, role) VALUES ($1,'Admin','admin'), ($2,'Client Co',null), ($3,'Freelancer',null), ($4,'Other',null)`, [U.admin, U.client, U.free, U.other])

const as = async (who) => { // simulate a signed-in browser user
  await db.exec(`SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '${U[who]}', false), set_config('afri.trusted', '', false)`)
}
const asService = async () => { await db.exec(`SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false)`) }
const one = async (sql, p) => (await db.query(sql, p)).rows[0]
const wallet = async who => one('SELECT balance::int, held::int, pending_withdrawal::int FROM wallets WHERE user_id = $1', [U[who]])
const fails = async (fn, re) => { await assert.rejects(fn, re) }

// ---- sign-up approval ----------------------------------------------------
let r = await one('SELECT account_status FROM profiles WHERE id = $1', [U.client])
assert.equal(r.account_status, 'pending', 'new sign-ups wait for approval')
assert.equal((await one('SELECT account_status FROM profiles WHERE id = $1', [U.admin])).account_status, 'active')
await as('client')
assert.equal((await one('SELECT public.is_active_user() AS a')).a, false)
await fails(() => db.query("SELECT public.admin_set_account_status($1, 'active')", [U.client]), /Admins only/)
await as('admin')
for (const k of ['client', 'free', 'other']) await db.query("SELECT public.admin_set_account_status($1, 'active')", [U[k]])
await fails(() => db.query("SELECT public.admin_set_account_status($1, 'blocked', 'x')", [U.admin]), /own account/)
console.log('✔ sign-up approval + admin-only status changes')

// ---- profile self-escalation blocked -------------------------------------
await as('client')
await db.query("UPDATE profiles SET account_status = 'active', role = 'admin', kyc_status = 'approved' WHERE id = $1", [U.client])
r = await one('SELECT role, kyc_status FROM profiles WHERE id = $1', [U.client])
assert.deepEqual([r.role, r.kyc_status], [null, 'unverified'])
console.log('✔ users cannot make themselves admin or KYC-approved')

// ---- top-up (server confirms payment) --------------------------------------
await asService()
await db.query("INSERT INTO payments (user_id, reference, amount, currency) VALUES ($1, 'afri_ref1', 10000000, 'NGN')", [U.client])
assert.equal((await one("SELECT public.credit_topup('afri_ref1', 10000000) AS r")).r, 'credited')
assert.equal((await one("SELECT public.credit_topup('afri_ref1', 10000000) AS r")).r, 'already_credited')
await db.query("INSERT INTO payments (user_id, reference, amount, currency) VALUES ($1, 'afri_ref2', 500000, 'NGN')", [U.client])
await fails(() => db.query("SELECT public.credit_topup('afri_ref2', 1)"), /Amount mismatch/)
assert.deepEqual(await wallet('client'), { balance: 10000000, held: 0, pending_withdrawal: 0 })
console.log('✔ top-up credited once (idempotent), tampered amount refused')

// ---- gig -> proposal -> hire -> fund -> submit -> release ------------------
await as('client')
const gig = await one("INSERT INTO gigs (title, description, budget, status, boosted_until, client_id) VALUES ('Logo design job', 'Design a logo and a brand kit please', 5000000, 'completed', now() + interval '99 days', $1) RETURNING *", [U.free])
assert.equal(gig.client_id, U.client, 'client_id forced to the caller')
assert.equal(gig.status, 'open'); assert.equal(gig.boosted_until, null)
await asService(); await db.query("UPDATE profiles SET kyc_status = 'approved' WHERE id = $1", [U.free])
await as('free')
const prop = await one("INSERT INTO gig_proposals (gig_id, cover_letter, amount, status) VALUES ($1, 'I have ten years of brand design experience.', 4000000, 'accepted') RETURNING *", [gig.id])
assert.equal(prop.status, 'pending')
assert.equal((await one('SELECT proposals_count FROM gigs WHERE id = $1', [gig.id])).proposals_count, 1)
await fails(() => db.query('SELECT public.hire_proposal($1)', [prop.id]), /Only the client/)
await as('client')
const cid = (await one('SELECT public.hire_proposal($1) AS id', [prop.id])).id
assert.equal((await one('SELECT status FROM gigs WHERE id = $1', [gig.id])).status, 'in_progress')
await db.query('SELECT public.fund_contract($1)', [cid])
assert.deepEqual(await wallet('client'), { balance: 6000000, held: 4000000, pending_withdrawal: 0 })
await fails(() => db.query('SELECT public.fund_contract($1)', [cid]), /already funded/)
await as('free')
await fails(() => db.query('SELECT public.release_contract($1)', [cid]), /not found/)
await db.query("SELECT public.submit_work($1, 'Files in the drive link')", [cid])
await as('client')
await db.query("SELECT public.release_contract($1, 5, 'Great work')", [cid])
assert.deepEqual(await wallet('client'), { balance: 6000000, held: 0, pending_withdrawal: 0 })
assert.deepEqual(await wallet('free'), { balance: 3600000, held: 0, pending_withdrawal: 0 }, '10% fee deducted')
assert.equal(Number((await one("SELECT sum(amount) s FROM platform_ledger WHERE type = 'fee'")).s), 400000)
assert.equal((await one('SELECT status, client_rating FROM contracts WHERE id = $1', [cid])).status, 'completed')
await fails(() => db.query('SELECT public.release_contract($1)', [cid]), /Nothing to release/)
console.log('✔ escrow happy path: hold → submit → release with 10% fee')

// ---- insufficient funds ------------------------------------------------------
const gig2 = await one("INSERT INTO gigs (title, description, budget) VALUES ('Big website build', 'Build a full e-commerce website for us', 90000000) RETURNING id")
await as('free')
const prop2 = await one("INSERT INTO gig_proposals (gig_id, cover_letter, amount) VALUES ($1, 'I build e-commerce websites every week.', 90000000) RETURNING id", [gig2.id])
await as('client')
const cid2 = (await one('SELECT public.hire_proposal($1) AS id', [prop2.id])).id
await fails(() => db.query('SELECT public.fund_contract($1)', [cid2]), /Insufficient wallet balance/)
assert.deepEqual(await wallet('client'), { balance: 6000000, held: 0, pending_withdrawal: 0 }, 'nothing moved')
await db.query("SELECT public.cancel_contract($1, 'too expensive')", [cid2])
assert.equal((await one('SELECT status FROM gigs WHERE id = $1', [gig2.id])).status, 'open')
console.log('✔ cannot overdraw; unfunded contract cancels cleanly')

// ---- dispute + admin split ----------------------------------------------------
const gig3 = await one("INSERT INTO gigs (title, description, budget) VALUES ('Translate documents', 'Translate 20 pages from French to English', 2000000) RETURNING id")
await as('free')
const prop3 = await one("INSERT INTO gig_proposals (gig_id, cover_letter, amount) VALUES ($1, 'Certified French-English translator here.', 2000000) RETURNING id", [gig3.id])
await as('client')
const cid3 = (await one('SELECT public.hire_proposal($1) AS id', [prop3.id])).id
await db.query('SELECT public.fund_contract($1)', [cid3])
await fails(() => db.query("SELECT public.cancel_contract($1)", [cid3]), /freelancer or through a dispute/)
const did = (await one("SELECT public.open_dispute($1, 'Only half delivered') AS id", [cid3])).id
await fails(() => db.query("SELECT public.admin_resolve_dispute($1, 'split', 1000000)", [did]), /Admins only/)
await as('admin')
await fails(() => db.query("SELECT public.admin_resolve_dispute($1, 'split', 99999999)", [did]), /Invalid resolution amount/)
await db.query("SELECT public.admin_resolve_dispute($1, 'split', 1000000, 'Half the pages were delivered')", [did])
assert.deepEqual(await wallet('client'), { balance: 5000000, held: 0, pending_withdrawal: 0 }, 'client refunded the other half')
assert.deepEqual(await wallet('free'), { balance: 4500000, held: 0, pending_withdrawal: 0 }, 'freelancer gets half minus 10%')
assert.equal((await one('SELECT status FROM contracts WHERE id = $1', [cid3])).status, 'settled')
console.log('✔ dispute: parties cannot self-refund; admin split settles both wallets')

// ---- freelancer walks away -> full refund -------------------------------------
await as('client')
const gig4 = await one("INSERT INTO gigs (title, description, budget) VALUES ('Short video edit', 'Edit a two-minute product video for social', 1000000) RETURNING id")
await as('free')
const prop4 = await one("INSERT INTO gig_proposals (gig_id, cover_letter, amount) VALUES ($1, 'Video editor with a fast turnaround time.', 1000000) RETURNING id", [gig4.id])
await as('client'); const cid4 = (await one('SELECT public.hire_proposal($1) AS id', [prop4.id])).id; await db.query('SELECT public.fund_contract($1)', [cid4])
await as('free'); await db.query("SELECT public.cancel_contract($1, 'cannot do it')", [cid4])
assert.deepEqual(await wallet('client'), { balance: 5000000, held: 0, pending_withdrawal: 0 })
console.log('✔ freelancer cancel refunds the client in full')

// ---- withdrawals ----------------------------------------------------------------
await as('free')
await fails(() => db.query("SELECT public.request_withdrawal(100, 'GTBank', '0123456789', 'Free Lancer')"), /Minimum withdrawal/)
await fails(() => db.query("SELECT public.request_withdrawal(99999999, 'GTBank', '0123456789', 'Free Lancer')"), /Insufficient/)
const wid = (await one("SELECT public.request_withdrawal(2000000, 'GTBank', '0123456789', 'Free Lancer') AS id")).id
assert.deepEqual(await wallet('free'), { balance: 2500000, held: 0, pending_withdrawal: 2000000 })
await as('admin')
await fails(() => db.query('SELECT public.admin_process_withdrawal($1, true)', [wid]), /reference/)
await db.query("SELECT public.admin_process_withdrawal($1, true, 'TRF-123')", [wid])
assert.deepEqual(await wallet('free'), { balance: 2500000, held: 0, pending_withdrawal: 0 })
await as('free'); const wid2 = (await one("SELECT public.request_withdrawal(500000, 'GTBank', '0123456789', 'Free Lancer') AS id")).id
await as('admin'); await db.query("SELECT public.admin_process_withdrawal($1, false, null, 'Name mismatch')", [wid2])
assert.deepEqual(await wallet('free'), { balance: 2500000, held: 0, pending_withdrawal: 0 }, 'declined withdrawal returned')
console.log('✔ withdrawals: min/limit checks, paid with reference, decline returns funds')

// ---- boosts & ads ----------------------------------------------------------------
await as('client')
const gig5 = await one("INSERT INTO gigs (title, description, budget) VALUES ('Social media manager', 'Manage our Instagram for one month please', 300000) RETURNING id")
await db.query("UPDATE gigs SET boosted_until = now() + interval '1 year' WHERE id = $1", [gig5.id])
assert.equal((await one('SELECT boosted_until FROM gigs WHERE id = $1', [gig5.id])).boosted_until, null, 'cannot self-boost for free')
await db.query("SELECT public.purchase_boost('gig', $1, 7)", [String(gig5.id)])
assert.ok((await one('SELECT boosted_until FROM gigs WHERE id = $1', [gig5.id])).boosted_until, 'boost applied')
assert.equal((await wallet('client')).balance, 5000000 - 700000)
await as('other')
await fails(() => db.query("SELECT public.purchase_boost('gig', $1, 7)", [String(gig5.id)]), /own active posts/)
await as('client')
const ad = (await one("SELECT public.create_ad_campaign('Hire with us', 'We are hiring designers across Lagos today', 'https://example.com', 'jobs', 7) AS id")).id
assert.equal((await wallet('client')).balance, 4300000 - 2100000)
await as('admin'); await db.query("SELECT public.admin_review_ad($1, false, 'Misleading')", [ad])
assert.equal((await wallet('client')).balance, 4300000, 'rejected ad refunded')
console.log('✔ boosts charged & protected; rejected ads refunded')

// ---- ledger integrity: balances == sum of ledger -------------------------------
const bad = await db.query(`SELECT w.user_id FROM wallets w JOIN (SELECT user_id, sum(amount) b, sum(held_change) h, sum(pending_change) p FROM wallet_transactions GROUP BY user_id) t USING (user_id)
  WHERE w.balance <> t.b OR w.held <> t.h OR w.pending_withdrawal <> t.p`)
assert.equal(bad.rows.length, 0)
console.log('✔ every wallet equals the sum of its ledger entries')

// ---- suspension -------------------------------------------------------------------
await as('admin'); await db.query("SELECT public.admin_set_account_status($1, 'suspended', 'Spam', now() + interval '3 days')", [U.client])
await as('client')
assert.equal((await one('SELECT public.is_active_user() a')).a, false)
await fails(() => db.query("SELECT public.purchase_boost('gig', $1, 1)", [String(gig5.id)]), /not active/)
await as('admin'); await db.query("SELECT public.admin_set_account_status($1, 'suspended', 'Spam', now() - interval '1 minute')", [U.client])
await as('client'); assert.equal((await one('SELECT public.is_active_user() a')).a, true, 'expired suspension lifts automatically')
console.log('✔ suspension blocks actions and expires automatically')

const stats = (await (async () => { await as('admin'); return one('SELECT public.admin_stats() s') })()).s
assert.equal(stats.users, 4)
console.log('✔ admin_stats:', JSON.stringify({ escrow_held: stats.escrow_held, revenue_30d: stats.revenue_30d, disputes_open: stats.disputes_open }))
console.log('\nALL ESCROW TESTS PASSED')
