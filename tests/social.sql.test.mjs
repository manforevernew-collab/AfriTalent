// Applies the escrow, notifications and social/marketplace migrations to PGlite (real Postgres)
// with a stand-in for Supabase's auth/storage schemas, then exercises the new flows.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const file = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const db = new PGlite()

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE PUBLICATION supabase_realtime;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, last_sign_in_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('email', current_setting('test.email', true)) $$;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

  CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), full_name text, role text DEFAULT 'user', user_type text,
    kyc_status text DEFAULT 'unverified', address_status text DEFAULT 'unverified', avatar_url text, setup_complete boolean DEFAULT false,
    created_at timestamptz DEFAULT now());
  CREATE TABLE jobs (id serial PRIMARY KEY, title text, company text, posted_by uuid, is_active boolean DEFAULT true);
  CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, claimed_by uuid, is_active boolean DEFAULT true);
  CREATE TABLE applications (id serial PRIMARY KEY, job_id int, user_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE reviews (id serial PRIMARY KEY); CREATE TABLE professionals (id serial PRIMARY KEY);
  CREATE TABLE company_claims (id serial PRIMARY KEY, status text, user_id uuid, company_id uuid, reviewer_note text);
  CREATE TABLE kyc_verifications (id serial PRIMARY KEY, user_id uuid, status text DEFAULT 'pending', auto_status text, auto_checked_at timestamptz,
    submitted_at timestamptz DEFAULT now(), reviewer_note text);
  CREATE TABLE address_verifications (id serial PRIMARY KEY, user_id uuid, status text DEFAULT 'pending', submitted_at timestamptz DEFAULT now());
  CREATE TABLE job_sync_runs (id serial); CREATE TABLE business_sync_runs (id serial);
  CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') $$;
  CREATE FUNCTION public.is_client_request() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(auth.role(), '') IN ('anon', 'authenticated') $$;
  CREATE FUNCTION public.protect_profile_columns() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER protect_profile_columns BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();
`)

await db.exec(file('supabase-admin-escrow-migration.sql'))
await db.exec(`
  CREATE OR REPLACE FUNCTION public.is_trusted_write() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('afri.trusted', true), '') = 'on' OR NOT public.is_client_request() $$;`)
await db.exec(file('supabase-notifications-migration.sql'))
console.log('✔ notifications migration applied')
await db.exec(file('supabase-social-marketplace-migration.sql'))
await db.exec(file('supabase-social-marketplace-migration.sql'))   // re-runnable
console.log('✔ social/marketplace migration applied (twice)')

const U = { admin: '00000000-0000-0000-0000-00000000000a', ada: '00000000-0000-0000-0000-0000000000a1', kofi: '00000000-0000-0000-0000-0000000000b2', zee: '00000000-0000-0000-0000-0000000000c3' }
for (const [k, id] of Object.entries(U)) await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${k}@test.dev`])
await db.query(`INSERT INTO profiles (id, full_name, role, user_type) VALUES ($1,'Admin','admin','business'), ($2,'Ada Obi','user','job_seeker'), ($3,'Kofi Mensah','user','business'), ($4,'Zee','user','job_seeker')`, [U.admin, U.ada, U.kofi, U.zee])

const as = async who => db.exec(`SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '${U[who]}', false), set_config('afri.trusted', '', false)`)
const asService = async () => db.exec(`SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false), set_config('afri.trusted', '', false)`)
const one = async (sql, p) => (await db.query(sql, p)).rows[0]
const all = async (sql, p) => (await db.query(sql, p)).rows
const wallet = async who => one('SELECT balance::int, held::int FROM wallets WHERE user_id = $1', [U[who]])
const notes = async who => (await all('SELECT kind, title FROM notifications WHERE user_id = $1 ORDER BY id', [U[who]]))

// ---- welcome message + usernames --------------------------------------------
let r = await one(`SELECT t.subject, m.from_admin, m.body FROM support_threads t JOIN support_messages m ON m.thread_id = t.id WHERE t.user_id = $1 AND t.category = 'welcome'`, [U.ada])
assert.ok(r && r.from_admin && /welcome to AfriTalent/i.test(r.body) && /Upload your CV/.test(r.body), 'job seeker welcome with tips')
r = await one(`SELECT m.body FROM support_threads t JOIN support_messages m ON m.thread_id = t.id WHERE t.user_id = $1`, [U.kofi])
assert.match(r.body, /Post jobs and gigs/, 'employer tips')
assert.equal((await all(`SELECT 1 FROM support_threads WHERE user_id = $1`, [U.admin])).length, 0, 'admins get no welcome')
assert.ok((await notes('ada')).some(n => n.kind === 'welcome'))
assert.equal((await one('SELECT username FROM profiles WHERE id = $1', [U.ada])).username, 'ada-obi')
console.log('✔ welcome message (tailored tips) + notification + usernames')

// activate accounts
await as('admin')
for (const k of ['ada', 'kofi', 'zee']) await db.query("SELECT public.admin_set_account_status($1, 'active')", [U[k]])
assert.ok((await notes('ada')).some(n => /approved/.test(n.title)))

// ---- KYC status sync -------------------------------------------------------------
await as('ada')
await db.query('INSERT INTO kyc_verifications (user_id, status) VALUES ($1, $2)', [U.ada, 'pending'])
assert.equal((await one('SELECT kyc_status FROM profiles WHERE id = $1', [U.ada])).kyc_status, 'pending', 'client KYC insert syncs profile')
await db.query("UPDATE profiles SET kyc_status = 'approved' WHERE id = $1", [U.ada])   // test stub doesn't protect; real trigger does
await as('admin')
await db.query("UPDATE kyc_verifications SET status = 'approved' WHERE user_id = $1", [U.ada])
assert.ok((await notes('ada')).some(n => /identity is verified/.test(n.title)))
console.log('✔ KYC status sync + notifications')

// ---- follows, posts, likes, comments ------------------------------------------------
await as('zee')
await db.query('INSERT INTO follows (following_id) VALUES ($1)', [U.ada])
assert.equal((await one('SELECT followers_count FROM profiles WHERE id = $1', [U.ada])).followers_count, 1)
assert.ok((await notes('ada')).some(n => n.kind === 'follow'))
await as('ada')
await db.query("UPDATE profiles SET followers_count = 999, headline = 'Interior designer' WHERE id = $1", [U.ada])
assert.equal((await one('SELECT followers_count FROM profiles WHERE id = $1', [U.ada])).followers_count, 1, 'counters cannot be forged')

const portfolio = await one(`INSERT INTO posts (kind, title, body, media, tags) VALUES ('portfolio', 'Lekki living room', 'Full redesign',
  '[{"url":"https://x.supabase.co/storage/v1/object/public/posts/a/1.jpg","type":"image"}]', '{Interior, design, interior}') RETURNING *`)
assert.equal(portfolio.author_id, U.ada)
assert.deepEqual(portfolio.tags.sort(), ['design', 'interior'])
await assert.rejects(() => db.query(`INSERT INTO posts (body, media) VALUES ('x', '[{"url":"javascript:alert(1)","type":"image"}]')`), /Invalid media/)
await assert.rejects(() => db.query(`INSERT INTO posts (kind, title) VALUES ('product', 'No price')`), /check/i)
assert.ok((await notes('zee')).some(n => n.kind === 'post'), 'followers notified of new posts')

const product = await one(`INSERT INTO posts (kind, title, body, price, stock) VALUES ('product', 'Handwoven Kente', 'Authentic', 2500000, 3) RETURNING *`)
await as('kofi')
await db.query('INSERT INTO post_likes (post_id) VALUES ($1)', [portfolio.id])
await db.query("INSERT INTO post_comments (post_id, body) VALUES ($1, 'Beautiful work!')", [portfolio.id])
r = await one('SELECT likes_count, comments_count FROM posts WHERE id = $1', [portfolio.id])
assert.deepEqual([r.likes_count, r.comments_count], [1, 1])
await db.query('DELETE FROM post_likes WHERE post_id = $1', [portfolio.id])
await db.query('INSERT INTO post_likes (post_id) VALUES ($1)', [portfolio.id])
assert.equal((await notes('ada')).filter(n => n.kind === 'like').length, 1, 'repeat likes → one unread notification')
assert.ok((await notes('ada')).some(n => n.kind === 'comment'))
await assert.rejects(() => db.query('UPDATE posts SET likes_count = 500 WHERE id = $1', [portfolio.id]).then(async () => {
  if ((await one('SELECT likes_count FROM posts WHERE id = $1', [portfolio.id])).likes_count === 500) throw new Error('forged')
  throw new Error('no-op ok')
}), /no-op ok/)
console.log('✔ follows, posts (media validation), likes, comments, counters, notifications')

// ---- feed + public profile ------------------------------------------------------------
await as('zee')
let feed = await all("SELECT id, kind, author_name, liked, following FROM public.get_feed('following')")
assert.deepEqual(feed.map(f => f.id).sort(), [portfolio.id, product.id].sort())
assert.ok(feed.every(f => f.following && f.author_name === 'Ada Obi'))
feed = await all("SELECT id FROM public.get_feed('market')")
assert.deepEqual(feed.map(f => f.id), [product.id])
const prof = (await one("SELECT public.get_public_profile('ada-obi') AS p")).p
assert.equal(prof.headline, 'Interior designer'); assert.equal(prof.is_following, true); assert.equal(prof.kyc_verified, true)
assert.equal(prof.followers, 1)
assert.equal((await all('SELECT * FROM public.get_post_comments($1)', [portfolio.id]))[0].author_name, 'Kofi Mensah')
console.log('✔ feed scopes + public profile + comments with authors')

// ---- marketplace escrow -----------------------------------------------------------------
await asService()
await db.query("SELECT public._wallet_apply($1, 10000000, 0, 0, 'topup', 'test topup')", [U.kofi])
await as('kofi')
await assert.rejects(() => db.query("SELECT public.place_order($1, 1, '')", [product.id]), /delivery address/)
await assert.rejects(() => db.query("SELECT public.place_order($1, 5, '12 Allen Avenue, Ikeja')", [product.id]), /Only 3 left/)
const o1 = (await one("SELECT public.place_order($1, 2, '12 Allen Avenue, Ikeja, Lagos') AS id", [product.id])).id
assert.deepEqual(await wallet('kofi'), { balance: 5000000, held: 5000000 })
assert.equal((await one('SELECT stock FROM posts WHERE id = $1', [product.id])).stock, 1)
assert.ok((await notes('ada')).some(n => /New order/.test(n.title)))
await assert.rejects(() => db.query("SELECT public.mark_order_shipped($1, 'GIG', 'T1')", [o1]), /Order not found/)
await as('ada')
await assert.rejects(() => db.query('SELECT public.mark_order_shipped($1)', [o1]), /tracking number/)
await db.query("SELECT public.mark_order_shipped($1, 'GIG Logistics', 'GIG-12345')", [o1])
await assert.rejects(() => db.query("SELECT public.confirm_order_delivery($1)", [o1]), /Order not found/)
await as('kofi')
await assert.rejects(() => db.query("SELECT public.cancel_order($1)", [o1]), /dispute instead/)
await db.query("SELECT public.confirm_order_delivery($1, 5, 'Lovely fabric')", [o1])
assert.deepEqual(await wallet('kofi'), { balance: 5000000, held: 0 })
const fee = Math.round(5000000 * Number((await one('SELECT platform_fee_percent FROM app_settings WHERE id = 1')).platform_fee_percent) / 100)
assert.deepEqual(await wallet('ada'), { balance: 5000000 - fee, held: 0 })
assert.equal((await one('SELECT status FROM orders WHERE id = $1', [o1])).status, 'completed')
console.log('✔ order: escrow hold → ship (tracking required) → buyer confirms → seller paid minus fee')

// cancel before shipping → refund + restock
const o2 = (await one("SELECT public.place_order($1, 1, '12 Allen Avenue, Ikeja, Lagos') AS id", [product.id])).id
assert.equal((await one('SELECT status FROM posts WHERE id = $1', [product.id])).status, 'sold_out')
await assert.rejects(() => db.query("SELECT public.place_order($1, 1, '12 Allen Avenue, Ikeja, Lagos')", [product.id]), /not available/)
await db.query("SELECT public.cancel_order($1, 'Changed my mind')", [o2])
assert.deepEqual(await wallet('kofi'), { balance: 5000000, held: 0 })
r = await one('SELECT stock, status FROM posts WHERE id = $1', [product.id])
assert.deepEqual([r.stock, r.status], [1, 'active'])
console.log('✔ order: buyer cancels before shipping → refunded + restocked')

// dispute → admin refund; auto-release after 14 days
const o3 = (await one("SELECT public.place_order($1, 1, '12 Allen Avenue, Ikeja, Lagos') AS id", [product.id])).id
await db.query("SELECT public.dispute_order($1, 'Seller is not responding at all')", [o3])
assert.ok((await notes('admin')).some(n => /dispute/i.test(n.title)))
await as('admin')
await db.query("SELECT public.admin_resolve_order($1, true, 'No delivery')", [o3])
assert.deepEqual(await wallet('kofi'), { balance: 5000000, held: 0 })
assert.equal((await one('SELECT status FROM orders WHERE id = $1', [o3])).status, 'refunded')

await as('ada')
const service = await one(`INSERT INTO posts (kind, title, price) VALUES ('service', '3D room render', 1000000) RETURNING id`)
await as('kofi')
const o4 = (await one('SELECT public.place_order($1) AS id', [service.id])).id
await as('ada')
await db.query("SELECT public.mark_order_shipped($1, NULL, NULL, NULL, 'Render delivered by email')", [o4])
await asService()
await db.query("UPDATE orders SET auto_release_at = now() - interval '1 minute' WHERE id = $1", [o4])
assert.equal((await one('SELECT public.release_due_orders() AS n')).n, 1)
assert.equal((await one('SELECT status FROM orders WHERE id = $1', [o4])).status, 'completed')
console.log('✔ order: dispute → admin refund; services auto-release after the hold period')

// ---- dashboard summary --------------------------------------------------------------------
await as('ada')
const sum = (await one('SELECT public.dashboard_summary() AS s')).s
assert.equal(sum.orders_sold, 4); assert.equal(Number(sum.rating), 5); assert.ok(sum.earned_total > 0)
assert.equal(sum.followers, 1); assert.ok(sum.recent_transactions.length > 0)
await as('zee')
await db.exec('GRANT USAGE ON SCHEMA auth TO authenticated, anon; SET ROLE authenticated')
assert.equal((await all('SELECT * FROM orders')).length, 0, 'orders private to their parties')
await as('kofi')
assert.equal((await all('SELECT * FROM orders')).length, 4, 'buyer sees own orders')
await assert.rejects(() => db.query("UPDATE orders SET status = 'completed'"), /permission denied/)
await db.exec('RESET ROLE')
console.log('✔ dashboard summary + order privacy')
console.log('\nAll social & marketplace SQL checks passed')
