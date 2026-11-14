-- AfriTalent: admin panel, account moderation, support chat, wallets, gigs & escrow,
-- disputes, withdrawals, boosts and ads.
-- Run AFTER supabase-kyc-business-migration.sql. Safe to re-run.
--
-- Money is stored in minor units (kobo / cents) as bigint. Every balance change goes
-- through public._wallet_apply(), which locks the wallet row, refuses to overdraw and
-- writes an immutable ledger entry. Browser users can never write wallets directly.

-- =============================================================================
-- 0. Settings
-- =============================================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id                      int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  require_signup_approval boolean NOT NULL DEFAULT true,
  currency                text    NOT NULL DEFAULT 'NGN',
  platform_fee_percent    numeric(5,2) NOT NULL DEFAULT 10,
  boost_price_per_day     bigint  NOT NULL DEFAULT 100000,      -- ₦1,000
  ad_price_per_day        jsonb   NOT NULL DEFAULT '{"home":500000,"jobs":300000,"businesses":300000,"gigs":300000}',
  min_withdrawal          bigint  NOT NULL DEFAULT 500000,      -- ₦5,000
  min_topup               bigint  NOT NULL DEFAULT 100000,      -- ₦1,000
  updated_at              timestamptz DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Settings readable" ON app_settings;
CREATE POLICY "Settings readable" ON app_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Settings admin update" ON app_settings;
CREATE POLICY "Settings admin update" ON app_settings FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Functions called from other SECURITY DEFINER functions set this flag so the
-- column-protection triggers below let their writes through.
CREATE OR REPLACE FUNCTION public.is_trusted_write()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('afri.trusted', true), '') = 'on' OR NOT public.is_client_request();
$$;

-- =============================================================================
-- 1. Account status: approval, suspension, blocking
-- =============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS account_status  text NOT NULL DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status_reason   text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_until timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved_at     timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved_by     uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_status_check') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_account_status_check
      CHECK (account_status IN ('pending', 'active', 'suspended', 'blocked', 'rejected'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS profiles_account_status_idx ON profiles (account_status);

-- New sign-ups wait for approval when the setting is on (existing users stay active).
CREATE OR REPLACE FUNCTION public.profiles_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    NEW.account_status := 'active';
  ELSIF (SELECT require_signup_approval FROM app_settings WHERE id = 1) THEN
    NEW.account_status := 'pending';
  ELSE
    NEW.account_status := 'active';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_before_insert ON profiles;
CREATE TRIGGER profiles_before_insert BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_before_insert();

-- Extend the earlier protection: users cannot change their own status fields either.
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_client_request() AND NOT public.is_admin() THEN
    NEW.role := OLD.role;
    NEW.kyc_status := OLD.kyc_status;
    NEW.address_status := OLD.address_status;
    NEW.account_status := OLD.account_status;
    NEW.status_reason := OLD.status_reason;
    NEW.suspended_until := OLD.suspended_until;
    NEW.approved_at := OLD.approved_at;
    NEW.approved_by := OLD.approved_by;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND (
      account_status = 'active'
      OR (account_status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until < now())
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_kyc_verified()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND kyc_status = 'approved');
$$;

-- Audit log of every admin action
CREATE TABLE IF NOT EXISTS admin_actions (
  id          bigserial PRIMARY KEY,
  admin_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions (created_at DESC);
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin actions admin read" ON admin_actions;
CREATE POLICY "Admin actions admin read" ON admin_actions FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin actions admin insert" ON admin_actions;
CREATE POLICY "Admin actions admin insert" ON admin_actions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND admin_id = auth.uid());

CREATE OR REPLACE FUNCTION public._log_admin(p_action text, p_type text, p_id text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (auth.uid(), p_action, p_type, p_id, p_details);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(p_user uuid, p_status text, p_reason text DEFAULT NULL, p_until timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own account status'; END IF;
  IF p_status NOT IN ('active', 'suspended', 'blocked', 'rejected', 'pending') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND role = 'admin') AND p_status <> 'active' THEN
    RAISE EXCEPTION 'Remove admin rights before restricting an admin';
  END IF;
  UPDATE profiles SET
    account_status = p_status,
    status_reason = CASE WHEN p_status = 'active' THEN NULL ELSE p_reason END,
    suspended_until = CASE WHEN p_status = 'suspended' THEN p_until ELSE NULL END,
    approved_at = CASE WHEN p_status = 'active' AND approved_at IS NULL THEN now() ELSE approved_at END,
    approved_by = CASE WHEN p_status = 'active' AND approved_by IS NULL THEN auth.uid() ELSE approved_by END
  WHERE id = p_user;
  PERFORM public._log_admin('account_' || p_status, 'user', p_user::text, jsonb_build_object('reason', p_reason, 'until', p_until));
END $$;

-- Users list with emails (auth.users is not readable from the browser)
CREATE OR REPLACE FUNCTION public.admin_list_users(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (id uuid, email text, full_name text, role text, user_type text, account_status text, status_reason text,
  suspended_until timestamptz, kyc_status text, address_status text, created_at timestamptz, last_sign_in_at timestamptz,
  balance bigint, held bigint, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN QUERY
  SELECT p.id, u.email::text, p.full_name::text, p.role::text, p.user_type::text, p.account_status::text, p.status_reason::text,
         p.suspended_until::timestamptz, p.kyc_status::text, p.address_status::text, p.created_at::timestamptz,
         u.last_sign_in_at::timestamptz, COALESCE(w.balance, 0)::bigint, COALESCE(w.held, 0)::bigint, count(*) OVER ()
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN wallets w ON w.user_id = p.id
  WHERE (p_status IS NULL OR p.account_status = p_status)
    AND (p_search IS NULL OR p_search = '' OR u.email ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%' OR p.id::text = p_search)
  ORDER BY p.created_at DESC
  LIMIT LEAST(p_limit, 200) OFFSET p_offset;
END $$;

-- =============================================================================
-- 2. Support chat (works even for suspended/blocked users so they can appeal)
-- =============================================================================
CREATE TABLE IF NOT EXISTS support_threads (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject         text NOT NULL,
  category        text DEFAULT 'general',
  status          text NOT NULL DEFAULT 'open',   -- open | closed
  last_message_at timestamptz DEFAULT now(),
  user_unread     int DEFAULT 0,
  admin_unread    int DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_messages (
  id         bigserial PRIMARY KEY,
  thread_id  bigint NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  from_admin boolean NOT NULL DEFAULT false,
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON support_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS support_threads_last_idx ON support_threads (status, last_message_at DESC);

CREATE OR REPLACE FUNCTION public.support_message_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.sender_id := COALESCE(auth.uid(), NEW.sender_id);
  NEW.from_admin := public.is_admin() AND NOT EXISTS (SELECT 1 FROM support_threads WHERE id = NEW.thread_id AND user_id = auth.uid());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_message_before_insert ON support_messages;
CREATE TRIGGER support_message_before_insert BEFORE INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_message_before_insert();

CREATE OR REPLACE FUNCTION public.support_message_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE support_threads SET
    last_message_at = NEW.created_at,
    status = 'open',
    user_unread = CASE WHEN NEW.from_admin THEN user_unread + 1 ELSE user_unread END,
    admin_unread = CASE WHEN NEW.from_admin THEN admin_unread ELSE admin_unread + 1 END
  WHERE id = NEW.thread_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_message_after_insert ON support_messages;
CREATE TRIGGER support_message_after_insert AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_message_after_insert();

ALTER TABLE support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Support threads read" ON support_threads;
CREATE POLICY "Support threads read" ON support_threads FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Support threads create" ON support_threads;
CREATE POLICY "Support threads create" ON support_threads FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Support threads update" ON support_threads;
CREATE POLICY "Support threads update" ON support_threads FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()) WITH CHECK (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Support messages read" ON support_messages;
CREATE POLICY "Support messages read" ON support_messages FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (SELECT 1 FROM support_threads t WHERE t.id = thread_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS "Support messages send" ON support_messages;
CREATE POLICY "Support messages send" ON support_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM support_threads t WHERE t.id = thread_id AND t.user_id = auth.uid()));

-- =============================================================================
-- 3. Wallets & ledger
-- =============================================================================
CREATE TABLE IF NOT EXISTS wallets (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  currency           text NOT NULL DEFAULT 'NGN',
  balance            bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),            -- spendable / withdrawable
  held               bigint NOT NULL DEFAULT 0 CHECK (held >= 0),               -- locked in escrow (as client)
  pending_withdrawal bigint NOT NULL DEFAULT 0 CHECK (pending_withdrawal >= 0), -- awaiting payout
  updated_at         timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type           text NOT NULL,   -- topup | escrow_hold | escrow_release | escrow_refund | earning | dispute_settlement
                                  -- | withdrawal | withdrawal_paid | withdrawal_reversal | boost | ad | ad_refund | adjustment
  amount         bigint NOT NULL, -- change to `balance`
  held_change    bigint NOT NULL DEFAULT 0,
  pending_change bigint NOT NULL DEFAULT 0,
  balance_after  bigint NOT NULL,
  description    text,
  contract_id    bigint,
  reference      text UNIQUE,
  metadata       jsonb DEFAULT '{}'::jsonb,
  created_by     uuid,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_ledger (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL,     -- fee | boost | ad | ad_refund
  amount      bigint NOT NULL,
  user_id     uuid,
  contract_id bigint,
  reference   text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL DEFAULT 'paystack',
  reference   text NOT NULL UNIQUE,
  amount      bigint NOT NULL,
  currency    text NOT NULL,
  status      text NOT NULL DEFAULT 'initialized',  -- initialized | success | failed
  raw         jsonb,
  created_at  timestamptz DEFAULT now(),
  verified_at timestamptz
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Wallet own read" ON wallets;
CREATE POLICY "Wallet own read" ON wallets FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Wallet tx own read" ON wallet_transactions;
CREATE POLICY "Wallet tx own read" ON wallet_transactions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Platform ledger admin read" ON platform_ledger;
CREATE POLICY "Platform ledger admin read" ON platform_ledger FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Payments own read" ON payments;
CREATE POLICY "Payments own read" ON payments FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
-- (no INSERT/UPDATE policies: only the functions below can move money)

CREATE OR REPLACE FUNCTION public._wallet_apply(p_user uuid, p_balance bigint, p_held bigint, p_pending bigint,
  p_type text, p_description text, p_contract bigint DEFAULT NULL, p_reference text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w wallets%ROWTYPE;
  tx_id bigint;
BEGIN
  INSERT INTO wallets (user_id, currency) VALUES (p_user, (SELECT currency FROM app_settings WHERE id = 1))
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM wallets WHERE user_id = p_user FOR UPDATE;
  IF w.balance + p_balance < 0 THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  IF w.held + p_held < 0 OR w.pending_withdrawal + p_pending < 0 THEN RAISE EXCEPTION 'Wallet state error'; END IF;
  UPDATE wallets SET balance = balance + p_balance, held = held + p_held,
    pending_withdrawal = pending_withdrawal + p_pending, updated_at = now()
  WHERE user_id = p_user RETURNING * INTO w;
  INSERT INTO wallet_transactions (user_id, type, amount, held_change, pending_change, balance_after, description, contract_id, reference, metadata, created_by)
  VALUES (p_user, p_type, p_balance, p_held, p_pending, w.balance, p_description, p_contract, p_reference, p_meta, auth.uid())
  RETURNING id INTO tx_id;
  RETURN tx_id;
END $$;

-- Card top-up confirmed by the payment provider (server only, idempotent per reference)
CREATE OR REPLACE FUNCTION public.credit_topup(p_reference text, p_amount bigint, p_raw jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown payment reference'; END IF;
  IF pay.status = 'success' THEN RETURN 'already_credited'; END IF;
  IF p_amount <> pay.amount THEN
    UPDATE payments SET status = 'failed', raw = p_raw, verified_at = now() WHERE id = pay.id;
    RAISE EXCEPTION 'Amount mismatch';
  END IF;
  PERFORM public._wallet_apply(pay.user_id, pay.amount, 0, 0, 'topup', 'Wallet top-up (card)', NULL, 'topup:' || p_reference);
  UPDATE payments SET status = 'success', raw = p_raw, verified_at = now() WHERE id = pay.id;
  RETURN 'credited';
END $$;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(p_user uuid, p_amount bigint, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  IF p_amount = 0 OR p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'Amount and reason are required'; END IF;
  PERFORM public._wallet_apply(p_user, p_amount, 0, 0, 'adjustment', 'Adjustment by AfriTalent: ' || p_reason);
  PERFORM public._log_admin('wallet_adjust', 'user', p_user::text, jsonb_build_object('amount', p_amount, 'reason', p_reason));
END $$;

-- =============================================================================
-- 4. Gigs, proposals, contracts (escrow), disputes
-- =============================================================================
CREATE TABLE IF NOT EXISTS gigs (
  id              bigserial PRIMARY KEY,
  client_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(title) BETWEEN 5 AND 150),
  description     text NOT NULL CHECK (length(description) BETWEEN 20 AND 5000),
  category        text,
  skills          text[] DEFAULT '{}',
  budget          bigint NOT NULL CHECK (budget > 0),
  currency        text NOT NULL DEFAULT 'NGN',
  deadline        date,
  location        text DEFAULT 'Remote',
  status          text NOT NULL DEFAULT 'open',  -- open | in_progress | completed | closed
  proposals_count int NOT NULL DEFAULT 0,
  boosted_until   timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gigs_status_idx ON gigs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS gigs_client_idx ON gigs (client_id);

CREATE TABLE IF NOT EXISTS gig_proposals (
  id            bigserial PRIMARY KEY,
  gig_id        bigint NOT NULL REFERENCES gigs(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  cover_letter  text NOT NULL CHECK (length(cover_letter) BETWEEN 20 AND 4000),
  amount        bigint NOT NULL CHECK (amount > 0),
  delivery_days int CHECK (delivery_days BETWEEN 1 AND 365),
  status        text NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | withdrawn
  created_at    timestamptz DEFAULT now(),
  UNIQUE (gig_id, freelancer_id)
);

CREATE TABLE IF NOT EXISTS contracts (
  id            bigserial PRIMARY KEY,
  gig_id        bigint REFERENCES gigs(id) ON DELETE SET NULL,
  proposal_id   bigint REFERENCES gig_proposals(id) ON DELETE SET NULL,
  client_id     uuid NOT NULL REFERENCES auth.users(id),
  freelancer_id uuid NOT NULL REFERENCES auth.users(id),
  title         text NOT NULL,
  description   text,
  amount        bigint NOT NULL CHECK (amount > 0),
  fee_percent   numeric(5,2) NOT NULL,
  currency      text NOT NULL,
  status        text NOT NULL DEFAULT 'awaiting_funding',
    -- awaiting_funding | funded | submitted | revision_requested | completed | disputed | refunded | settled | cancelled
  funded_at     timestamptz,
  submitted_at  timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  client_rating int CHECK (client_rating BETWEEN 1 AND 5),
  client_review text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_client_idx ON contracts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contracts_freelancer_idx ON contracts (freelancer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contract_messages (
  id          bigserial PRIMARY KEY,
  contract_id bigint NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  kind        text NOT NULL DEFAULT 'message',  -- message | system | submission | revision | admin
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_messages_idx ON contract_messages (contract_id, created_at);

CREATE TABLE IF NOT EXISTS disputes (
  id                bigserial PRIMARY KEY,
  contract_id       bigint NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  opened_by         uuid NOT NULL REFERENCES auth.users(id),
  reason            text NOT NULL,
  details           text,
  status            text NOT NULL DEFAULT 'open',  -- open | resolved
  resolution        text,                          -- release | refund | split
  freelancer_amount bigint,
  admin_note        text,
  resolved_by       uuid REFERENCES auth.users(id),
  resolved_at       timestamptz,
  created_at        timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_open ON disputes (contract_id) WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.is_contract_party(p_contract bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM contracts WHERE id = p_contract AND auth.uid() IN (client_id, freelancer_id));
$$;

-- Column protection for direct client writes
CREATE OR REPLACE FUNCTION public.gigs_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_trusted_write() AND NOT public.is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.client_id := auth.uid();
      NEW.status := 'open';
      NEW.proposals_count := 0;
      NEW.boosted_until := NULL;
      NEW.currency := (SELECT currency FROM app_settings WHERE id = 1);
    ELSE
      NEW.client_id := OLD.client_id;
      NEW.proposals_count := OLD.proposals_count;
      NEW.boosted_until := OLD.boosted_until;
      NEW.currency := OLD.currency;
      -- owners may only close / reopen an open gig themselves
      IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status IN ('open', 'closed') AND NEW.status IN ('open', 'closed')) THEN
        NEW.status := OLD.status;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gigs_before_write ON gigs;
CREATE TRIGGER gigs_before_write BEFORE INSERT OR UPDATE ON gigs FOR EACH ROW EXECUTE FUNCTION public.gigs_before_write();

CREATE OR REPLACE FUNCTION public.proposals_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_trusted_write() AND NOT public.is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.freelancer_id := auth.uid();
      NEW.status := 'pending';
    ELSE
      NEW.freelancer_id := OLD.freelancer_id;
      NEW.gig_id := OLD.gig_id;
      IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'This proposal can no longer be changed'; END IF;
      IF NEW.status NOT IN ('pending', 'withdrawn') THEN NEW.status := OLD.status; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proposals_before_write ON gig_proposals;
CREATE TRIGGER proposals_before_write BEFORE INSERT OR UPDATE ON gig_proposals FOR EACH ROW EXECUTE FUNCTION public.proposals_before_write();

CREATE OR REPLACE FUNCTION public.proposals_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE gigs SET proposals_count = proposals_count + 1 WHERE id = NEW.gig_id;
  PERFORM set_config('afri.trusted', 'off', true);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proposals_after_insert ON gig_proposals;
CREATE TRIGGER proposals_after_insert AFTER INSERT ON gig_proposals FOR EACH ROW EXECUTE FUNCTION public.proposals_after_insert();

CREATE OR REPLACE FUNCTION public.contract_message_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_trusted_write() THEN
    NEW.sender_id := auth.uid();
    NEW.kind := CASE WHEN public.is_admin() AND NOT public.is_contract_party(NEW.contract_id) THEN 'admin' ELSE 'message' END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contract_message_before_insert ON contract_messages;
CREATE TRIGGER contract_message_before_insert BEFORE INSERT ON contract_messages FOR EACH ROW EXECUTE FUNCTION public.contract_message_before_insert();

ALTER TABLE gigs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gig_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gigs public read" ON gigs;
CREATE POLICY "Gigs public read" ON gigs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Gigs create" ON gigs;
CREATE POLICY "Gigs create" ON gigs FOR INSERT TO authenticated WITH CHECK (client_id = auth.uid());
DROP POLICY IF EXISTS "Gigs owner update" ON gigs;
CREATE POLICY "Gigs owner update" ON gigs FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.is_admin()) WITH CHECK (client_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Proposals read" ON gig_proposals;
CREATE POLICY "Proposals read" ON gig_proposals FOR SELECT TO authenticated
  USING (freelancer_id = auth.uid() OR public.is_admin() OR EXISTS (SELECT 1 FROM gigs g WHERE g.id = gig_id AND g.client_id = auth.uid()));
DROP POLICY IF EXISTS "Proposals create" ON gig_proposals;
CREATE POLICY "Proposals create" ON gig_proposals FOR INSERT TO authenticated
  WITH CHECK (freelancer_id = auth.uid() AND public.is_kyc_verified()
    AND EXISTS (SELECT 1 FROM gigs g WHERE g.id = gig_id AND g.status = 'open' AND g.client_id <> auth.uid()));
DROP POLICY IF EXISTS "Proposals own update" ON gig_proposals;
CREATE POLICY "Proposals own update" ON gig_proposals FOR UPDATE TO authenticated
  USING (freelancer_id = auth.uid()) WITH CHECK (freelancer_id = auth.uid());

DROP POLICY IF EXISTS "Contracts parties read" ON contracts;
CREATE POLICY "Contracts parties read" ON contracts FOR SELECT TO authenticated
  USING (auth.uid() IN (client_id, freelancer_id) OR public.is_admin());
DROP POLICY IF EXISTS "Contract messages read" ON contract_messages;
CREATE POLICY "Contract messages read" ON contract_messages FOR SELECT TO authenticated
  USING (public.is_contract_party(contract_id) OR public.is_admin());
DROP POLICY IF EXISTS "Contract messages send" ON contract_messages;
CREATE POLICY "Contract messages send" ON contract_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_contract_party(contract_id) OR public.is_admin());
DROP POLICY IF EXISTS "Disputes read" ON disputes;
CREATE POLICY "Disputes read" ON disputes FOR SELECT TO authenticated
  USING (public.is_contract_party(contract_id) OR public.is_admin());

CREATE OR REPLACE FUNCTION public._contract_note(p_contract bigint, p_kind text, p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('afri.trusted', 'on', true);
  INSERT INTO contract_messages (contract_id, sender_id, kind, body) VALUES (p_contract, auth.uid(), p_kind, p_body);
END $$;

CREATE OR REPLACE FUNCTION public.decline_proposal(p_proposal bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM gig_proposals p JOIN gigs g ON g.id = p.gig_id WHERE p.id = p_proposal AND g.client_id = auth.uid() AND p.status = 'pending') THEN
    RAISE EXCEPTION 'Proposal not found';
  END IF;
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE gig_proposals SET status = 'declined' WHERE id = p_proposal;
END $$;

CREATE OR REPLACE FUNCTION public.hire_proposal(p_proposal bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p gig_proposals%ROWTYPE; g gigs%ROWTYPE; s app_settings%ROWTYPE; cid bigint;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Your account is not active'; END IF;
  SELECT * INTO p FROM gig_proposals WHERE id = p_proposal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;
  SELECT * INTO g FROM gigs WHERE id = p.gig_id FOR UPDATE;
  IF g.client_id <> auth.uid() THEN RAISE EXCEPTION 'Only the client can hire for this gig'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'This proposal is no longer available'; END IF;
  IF g.status <> 'open' THEN RAISE EXCEPTION 'This gig is not open'; END IF;
  SELECT * INTO s FROM app_settings WHERE id = 1;
  INSERT INTO contracts (gig_id, proposal_id, client_id, freelancer_id, title, description, amount, fee_percent, currency)
  VALUES (g.id, p.id, g.client_id, p.freelancer_id, g.title, g.description, p.amount, s.platform_fee_percent, g.currency)
  RETURNING id INTO cid;
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE gig_proposals SET status = 'accepted' WHERE id = p.id;
  UPDATE gigs SET status = 'in_progress' WHERE id = g.id;
  PERFORM public._contract_note(cid, 'system', 'Contract created. The client funds the escrow, then work begins.');
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.fund_contract(p_contract bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR c.client_id <> auth.uid() THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'awaiting_funding' THEN RAISE EXCEPTION 'This contract is already funded'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Your account is not active'; END IF;
  PERFORM public._wallet_apply(c.client_id, -c.amount, c.amount, 0, 'escrow_hold', 'Escrow funded: ' || c.title, c.id);
  UPDATE contracts SET status = 'funded', funded_at = now(), updated_at = now() WHERE id = c.id;
  PERFORM public._contract_note(c.id, 'system', 'Escrow funded. The freelancer can start work — payment is released when the client approves.');
END $$;

CREATE OR REPLACE FUNCTION public.submit_work(p_contract bigint, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR c.freelancer_id <> auth.uid() THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status NOT IN ('funded', 'revision_requested') THEN RAISE EXCEPTION 'Work can only be submitted on a funded contract'; END IF;
  UPDATE contracts SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = c.id;
  PERFORM public._contract_note(c.id, 'submission', COALESCE(NULLIF(trim(p_note), ''), 'Work submitted for review.'));
END $$;

CREATE OR REPLACE FUNCTION public.request_revision(p_contract bigint, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR c.client_id <> auth.uid() THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'submitted' THEN RAISE EXCEPTION 'You can only request changes after work is submitted'; END IF;
  UPDATE contracts SET status = 'revision_requested', updated_at = now() WHERE id = c.id;
  PERFORM public._contract_note(c.id, 'revision', COALESCE(NULLIF(trim(p_note), ''), 'Changes requested.'));
END $$;

CREATE OR REPLACE FUNCTION public.release_contract(p_contract bigint, p_rating int DEFAULT NULL, p_review text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contracts%ROWTYPE; fee bigint;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR c.client_id <> auth.uid() THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status NOT IN ('funded', 'submitted', 'revision_requested') THEN RAISE EXCEPTION 'Nothing to release'; END IF;
  fee := round(c.amount * c.fee_percent / 100);
  PERFORM public._wallet_apply(c.client_id, 0, -c.amount, 0, 'escrow_release', 'Payment released: ' || c.title, c.id);
  PERFORM public._wallet_apply(c.freelancer_id, c.amount - fee, 0, 0, 'earning', 'Earning: ' || c.title, c.id,
    NULL, jsonb_build_object('gross', c.amount, 'fee', fee));
  IF fee > 0 THEN INSERT INTO platform_ledger (type, amount, user_id, contract_id) VALUES ('fee', fee, c.freelancer_id, c.id); END IF;
  UPDATE contracts SET status = 'completed', completed_at = now(), updated_at = now(),
    client_rating = CASE WHEN p_rating BETWEEN 1 AND 5 THEN p_rating END, client_review = left(p_review, 2000)
  WHERE id = c.id;
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE gigs SET status = 'completed' WHERE id = c.gig_id;
  PERFORM public._contract_note(c.id, 'system', 'Client approved the work. Payment released to the freelancer.');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_contract(p_contract bigint, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (c.client_id, c.freelancer_id) THEN RAISE EXCEPTION 'Contract not found'; END IF;
  PERFORM set_config('afri.trusted', 'on', true);
  IF c.status = 'awaiting_funding' THEN
    UPDATE contracts SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = c.id;
  ELSIF c.status IN ('funded', 'submitted', 'revision_requested') AND auth.uid() = c.freelancer_id THEN
    -- the freelancer can always walk away and refund the client in full
    PERFORM public._wallet_apply(c.client_id, c.amount, -c.amount, 0, 'escrow_refund', 'Escrow refunded: ' || c.title, c.id);
    UPDATE contracts SET status = 'refunded', cancelled_at = now(), updated_at = now() WHERE id = c.id;
  ELSE
    RAISE EXCEPTION 'A funded contract can only be refunded by the freelancer or through a dispute';
  END IF;
  UPDATE gigs SET status = 'open' WHERE id = c.gig_id AND status = 'in_progress';
  UPDATE gig_proposals SET status = 'declined' WHERE id = c.proposal_id;
  PERFORM public._contract_note(c.id, 'system', 'Contract cancelled' || COALESCE(': ' || NULLIF(trim(p_reason), ''), '.'));
END $$;

CREATE OR REPLACE FUNCTION public.open_dispute(p_contract bigint, p_reason text, p_details text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c contracts%ROWTYPE; did bigint;
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (c.client_id, c.freelancer_id) THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status NOT IN ('funded', 'submitted', 'revision_requested') THEN RAISE EXCEPTION 'Disputes can only be opened on funded contracts'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'Give a reason for the dispute'; END IF;
  INSERT INTO disputes (contract_id, opened_by, reason, details) VALUES (c.id, auth.uid(), left(p_reason, 200), left(p_details, 4000))
  RETURNING id INTO did;
  UPDATE contracts SET status = 'disputed', updated_at = now() WHERE id = c.id;
  PERFORM public._contract_note(c.id, 'system', 'Dispute opened: ' || left(p_reason, 200) || '. Funds stay in escrow until AfriTalent resolves it.');
  RETURN did;
END $$;

CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(p_dispute bigint, p_resolution text, p_freelancer_amount bigint DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d disputes%ROWTYPE; c contracts%ROWTYPE; fa bigint; fee bigint; final_status text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO d FROM disputes WHERE id = p_dispute FOR UPDATE;
  IF NOT FOUND OR d.status <> 'open' THEN RAISE EXCEPTION 'Dispute not open'; END IF;
  SELECT * INTO c FROM contracts WHERE id = d.contract_id FOR UPDATE;
  IF c.status <> 'disputed' THEN RAISE EXCEPTION 'Contract is not in dispute'; END IF;
  fa := CASE p_resolution WHEN 'release' THEN c.amount WHEN 'refund' THEN 0 WHEN 'split' THEN p_freelancer_amount END;
  IF fa IS NULL OR fa < 0 OR fa > c.amount THEN RAISE EXCEPTION 'Invalid resolution amount'; END IF;
  fee := round(fa * c.fee_percent / 100);
  PERFORM public._wallet_apply(c.client_id, c.amount - fa, -c.amount, 0, 'dispute_settlement',
    'Dispute settled: ' || c.title || CASE WHEN c.amount - fa > 0 THEN ' (refund)' ELSE '' END, c.id);
  IF fa > 0 THEN
    PERFORM public._wallet_apply(c.freelancer_id, fa - fee, 0, 0, 'earning', 'Dispute settlement: ' || c.title, c.id,
      NULL, jsonb_build_object('gross', fa, 'fee', fee));
    IF fee > 0 THEN INSERT INTO platform_ledger (type, amount, user_id, contract_id) VALUES ('fee', fee, c.freelancer_id, c.id); END IF;
  END IF;
  final_status := CASE WHEN fa = c.amount THEN 'completed' WHEN fa = 0 THEN 'refunded' ELSE 'settled' END;
  UPDATE contracts SET status = final_status, completed_at = now(), updated_at = now() WHERE id = c.id;
  UPDATE disputes SET status = 'resolved', resolution = p_resolution, freelancer_amount = fa, admin_note = p_note,
    resolved_by = auth.uid(), resolved_at = now() WHERE id = d.id;
  PERFORM public._contract_note(c.id, 'admin', 'Dispute resolved by AfriTalent (' || p_resolution || ')' || COALESCE(': ' || NULLIF(trim(p_note), ''), '.'));
  PERFORM public._log_admin('dispute_resolve', 'dispute', d.id::text, jsonb_build_object('resolution', p_resolution, 'freelancer_amount', fa));
END $$;

-- =============================================================================
-- 5. Withdrawals
-- =============================================================================
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount           bigint NOT NULL CHECK (amount > 0),
  bank_name        text NOT NULL,
  account_number   text NOT NULL,
  account_name     text NOT NULL,
  status           text NOT NULL DEFAULT 'pending',  -- pending | paid | rejected
  admin_note       text,
  payout_reference text,
  processed_by     uuid,
  processed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Withdrawals own read" ON withdrawal_requests;
CREATE POLICY "Withdrawals own read" ON withdrawal_requests FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount bigint, p_bank_name text, p_account_number text, p_account_name text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wid bigint; s app_settings%ROWTYPE;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Your account is not active'; END IF;
  IF NOT public.is_kyc_verified() THEN RAISE EXCEPTION 'Complete identity verification before withdrawing'; END IF;
  SELECT * INTO s FROM app_settings WHERE id = 1;
  IF p_amount < s.min_withdrawal THEN RAISE EXCEPTION 'Minimum withdrawal is %', s.min_withdrawal / 100; END IF;
  IF length(trim(p_bank_name)) < 2 OR p_account_number !~ '^[0-9]{6,20}$' OR length(trim(p_account_name)) < 3 THEN
    RAISE EXCEPTION 'Enter valid bank details';
  END IF;
  INSERT INTO withdrawal_requests (user_id, amount, bank_name, account_number, account_name)
  VALUES (auth.uid(), p_amount, trim(p_bank_name), p_account_number, trim(p_account_name)) RETURNING id INTO wid;
  PERFORM public._wallet_apply(auth.uid(), -p_amount, 0, p_amount, 'withdrawal', 'Withdrawal to ' || trim(p_bank_name) || ' ••••' || right(p_account_number, 4), NULL, 'wd:' || wid);
  RETURN wid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_process_withdrawal(p_id bigint, p_paid boolean, p_reference text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO w FROM withdrawal_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR w.status <> 'pending' THEN RAISE EXCEPTION 'Withdrawal is not pending'; END IF;
  IF p_paid THEN
    IF p_reference IS NULL OR length(trim(p_reference)) < 3 THEN RAISE EXCEPTION 'Enter the bank/transfer reference'; END IF;
    PERFORM public._wallet_apply(w.user_id, 0, 0, -w.amount, 'withdrawal_paid', 'Withdrawal paid (ref ' || trim(p_reference) || ')', NULL, 'wdpaid:' || w.id);
  ELSE
    PERFORM public._wallet_apply(w.user_id, w.amount, 0, -w.amount, 'withdrawal_reversal', 'Withdrawal declined' || COALESCE(': ' || p_note, ''), NULL, 'wdrev:' || w.id);
  END IF;
  UPDATE withdrawal_requests SET status = CASE WHEN p_paid THEN 'paid' ELSE 'rejected' END, payout_reference = p_reference,
    admin_note = p_note, processed_by = auth.uid(), processed_at = now() WHERE id = w.id;
  PERFORM public._log_admin(CASE WHEN p_paid THEN 'withdrawal_paid' ELSE 'withdrawal_rejected' END, 'withdrawal', w.id::text,
    jsonb_build_object('amount', w.amount, 'reference', p_reference, 'note', p_note));
END $$;

-- =============================================================================
-- 6. Boosts & ads (paid from the wallet)
-- =============================================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS boosted_until timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS boosted_until timestamptz;
CREATE INDEX IF NOT EXISTS jobs_boosted_idx ON jobs (boosted_until) WHERE boosted_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS companies_boosted_idx ON companies (boosted_until) WHERE boosted_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS gigs_boosted_idx ON gigs (boosted_until) WHERE boosted_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_boost_column()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_trusted_write() AND NOT public.is_admin() THEN
    NEW.boosted_until := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.boosted_until END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_protect_boost ON jobs;
CREATE TRIGGER jobs_protect_boost BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION public.protect_boost_column();
DROP TRIGGER IF EXISTS companies_protect_boost ON companies;
CREATE TRIGGER companies_protect_boost BEFORE INSERT OR UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION public.protect_boost_column();

CREATE TABLE IF NOT EXISTS boosts (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL,  -- job | gig | company
  target_id   text NOT NULL,
  days        int NOT NULL,
  amount      bigint NOT NULL,
  ends_at     timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE boosts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Boosts own read" ON boosts;
CREATE POLICY "Boosts own read" ON boosts FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.purchase_boost(p_target_type text, p_target_id text, p_days int)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE price bigint; owner_ok boolean; new_until timestamptz;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Your account is not active'; END IF;
  IF p_days NOT IN (1, 3, 7, 14, 30) THEN RAISE EXCEPTION 'Choose 1, 3, 7, 14 or 30 days'; END IF;
  owner_ok := CASE p_target_type
    WHEN 'job' THEN EXISTS (SELECT 1 FROM jobs WHERE id::text = p_target_id AND posted_by = auth.uid())
    WHEN 'gig' THEN EXISTS (SELECT 1 FROM gigs WHERE id::text = p_target_id AND client_id = auth.uid() AND status = 'open')
    WHEN 'company' THEN EXISTS (SELECT 1 FROM companies WHERE id::text = p_target_id AND claimed_by = auth.uid())
    ELSE false END;
  IF NOT owner_ok THEN RAISE EXCEPTION 'You can only boost your own active posts'; END IF;
  price := (SELECT boost_price_per_day FROM app_settings WHERE id = 1) * p_days;
  PERFORM public._wallet_apply(auth.uid(), -price, 0, 0, 'boost', 'Boost ' || p_target_type || ' for ' || p_days || ' day(s)');
  INSERT INTO platform_ledger (type, amount, user_id) VALUES ('boost', price, auth.uid());
  PERFORM set_config('afri.trusted', 'on', true);
  IF p_target_type = 'job' THEN
    UPDATE jobs SET boosted_until = GREATEST(COALESCE(boosted_until, now()), now()) + make_interval(days => p_days) WHERE id::text = p_target_id RETURNING boosted_until INTO new_until;
  ELSIF p_target_type = 'gig' THEN
    UPDATE gigs SET boosted_until = GREATEST(COALESCE(boosted_until, now()), now()) + make_interval(days => p_days) WHERE id::text = p_target_id RETURNING boosted_until INTO new_until;
  ELSE
    UPDATE companies SET boosted_until = GREATEST(COALESCE(boosted_until, now()), now()) + make_interval(days => p_days) WHERE id::text = p_target_id RETURNING boosted_until INTO new_until;
  END IF;
  INSERT INTO boosts (user_id, target_type, target_id, days, amount, ends_at) VALUES (auth.uid(), p_target_type, p_target_id, p_days, price, new_until);
  RETURN new_until;
END $$;

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
  body        text NOT NULL CHECK (length(body) BETWEEN 10 AND 220),
  image_url   text,
  target_url  text NOT NULL CHECK (target_url ~ '^https?://'),
  placement   text NOT NULL,  -- home | jobs | businesses | gigs
  days        int NOT NULL,
  amount      bigint NOT NULL,
  status      text NOT NULL DEFAULT 'pending_review',  -- pending_review | active | rejected | ended
  starts_at   timestamptz,
  ends_at     timestamptz,
  impressions bigint NOT NULL DEFAULT 0,
  clicks      bigint NOT NULL DEFAULT 0,
  admin_note  text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_campaigns_live_idx ON ad_campaigns (placement, status, ends_at);
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ads live public" ON ad_campaigns;
CREATE POLICY "Ads live public" ON ad_campaigns FOR SELECT USING (status = 'active' AND ends_at > now());
DROP POLICY IF EXISTS "Ads own or admin" ON ad_campaigns;
CREATE POLICY "Ads own or admin" ON ad_campaigns FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.create_ad_campaign(p_title text, p_body text, p_target_url text, p_placement text, p_days int, p_image_url text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE price_day bigint; total bigint; aid bigint;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Your account is not active'; END IF;
  IF p_days NOT IN (3, 7, 14, 30) THEN RAISE EXCEPTION 'Choose 3, 7, 14 or 30 days'; END IF;
  price_day := ((SELECT ad_price_per_day FROM app_settings WHERE id = 1) ->> p_placement)::bigint;
  IF price_day IS NULL THEN RAISE EXCEPTION 'Unknown placement'; END IF;
  IF p_image_url IS NOT NULL AND p_image_url !~ '^https://' THEN RAISE EXCEPTION 'Image must be an https:// URL'; END IF;
  total := price_day * p_days;
  INSERT INTO ad_campaigns (user_id, title, body, image_url, target_url, placement, days, amount)
  VALUES (auth.uid(), trim(p_title), trim(p_body), NULLIF(trim(p_image_url), ''), trim(p_target_url), p_placement, p_days, total)
  RETURNING id INTO aid;
  PERFORM public._wallet_apply(auth.uid(), -total, 0, 0, 'ad', 'Ad campaign: ' || trim(p_title), NULL, 'ad:' || aid);
  INSERT INTO platform_ledger (type, amount, user_id, reference) VALUES ('ad', total, auth.uid(), 'ad:' || aid);
  RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_review_ad(p_id bigint, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a ad_campaigns%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO a FROM ad_campaigns WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR a.status <> 'pending_review' THEN RAISE EXCEPTION 'Ad is not awaiting review'; END IF;
  IF p_approve THEN
    UPDATE ad_campaigns SET status = 'active', starts_at = now(), ends_at = now() + make_interval(days => a.days), admin_note = p_note WHERE id = a.id;
  ELSE
    PERFORM public._wallet_apply(a.user_id, a.amount, 0, 0, 'ad_refund', 'Ad not approved — refunded: ' || a.title, NULL, 'adrefund:' || a.id);
    INSERT INTO platform_ledger (type, amount, user_id, reference) VALUES ('ad_refund', -a.amount, a.user_id, 'ad:' || a.id);
    UPDATE ad_campaigns SET status = 'rejected', admin_note = p_note WHERE id = a.id;
  END IF;
  PERFORM public._log_admin(CASE WHEN p_approve THEN 'ad_approved' ELSE 'ad_rejected' END, 'ad', a.id::text, jsonb_build_object('note', p_note));
END $$;

CREATE OR REPLACE FUNCTION public.record_ad_event(p_id bigint, p_click boolean DEFAULT false)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ad_campaigns SET impressions = impressions + CASE WHEN p_click THEN 0 ELSE 1 END,
    clicks = clicks + CASE WHEN p_click THEN 1 ELSE 0 END
  WHERE id = p_id AND status = 'active' AND ends_at > now();
$$;

-- =============================================================================
-- 7. Restricted accounts can't act (pending / suspended / blocked)
--    RESTRICTIVE policies are AND-ed with the existing permissive ones.
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs', 'applications', 'reviews', 'professionals', 'company_claims', 'companies', 'gigs', 'gig_proposals'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Active accounts only (insert)" ON %I', t);
      EXECUTE format('CREATE POLICY "Active accounts only (insert)" ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.is_active_user() OR public.is_admin())', t);
      EXECUTE format('DROP POLICY IF EXISTS "Active accounts only (update)" ON %I', t);
      EXECUTE format('CREATE POLICY "Active accounts only (update)" ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.is_active_user() OR public.is_admin())', t);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS "Active accounts only (insert)" ON contract_messages;
CREATE POLICY "Active accounts only (insert)" ON contract_messages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() OR public.is_admin());

-- =============================================================================
-- 8. Admin dashboard numbers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN jsonb_build_object(
    'users', (SELECT count(*) FROM profiles),
    'pending', (SELECT count(*) FROM profiles WHERE account_status = 'pending'),
    'suspended', (SELECT count(*) FROM profiles WHERE account_status = 'suspended'),
    'blocked', (SELECT count(*) FROM profiles WHERE account_status = 'blocked'),
    'signups_7d', (SELECT count(*) FROM profiles WHERE created_at > now() - interval '7 days'),
    'kyc_pending', (SELECT count(*) FROM kyc_verifications WHERE status = 'pending'),
    'kyc_auto_rejected_7d', (SELECT count(*) FROM kyc_verifications WHERE auto_status = 'rejected' AND auto_checked_at > now() - interval '7 days'),
    'jobs_active', (SELECT count(*) FROM jobs WHERE COALESCE(is_active, true)),
    'companies', (SELECT count(*) FROM companies WHERE COALESCE(is_active, true)),
    'gigs_open', (SELECT count(*) FROM gigs WHERE status = 'open'),
    'contracts_active', (SELECT count(*) FROM contracts WHERE status IN ('funded', 'submitted', 'revision_requested')),
    'disputes_open', (SELECT count(*) FROM disputes WHERE status = 'open'),
    'escrow_held', (SELECT COALESCE(sum(held), 0) FROM wallets),
    'wallet_balances', (SELECT COALESCE(sum(balance), 0) FROM wallets),
    'withdrawals_pending', (SELECT count(*) FROM withdrawal_requests WHERE status = 'pending'),
    'withdrawals_pending_amount', (SELECT COALESCE(sum(amount), 0) FROM withdrawal_requests WHERE status = 'pending'),
    'revenue_30d', (SELECT COALESCE(sum(amount), 0) FROM platform_ledger WHERE created_at > now() - interval '30 days'),
    'ads_pending', (SELECT count(*) FROM ad_campaigns WHERE status = 'pending_review'),
    'support_open', (SELECT count(*) FROM support_threads WHERE status = 'open'),
    'support_unread', (SELECT COALESCE(sum(admin_unread), 0) FROM support_threads WHERE status = 'open'),
    'claims_pending', (SELECT count(*) FROM company_claims WHERE status = 'pending')
  );
END $$;

-- =============================================================================
-- 9. Function permissions (Supabase grants EXECUTE to everyone by default)
-- =============================================================================
REVOKE ALL ON FUNCTION public._wallet_apply(uuid, bigint, bigint, bigint, text, text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_topup(text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_topup(text, bigint, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._log_admin(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._contract_note(bigint, text, text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_set_account_status(uuid, text, text, timestamptz)', 'public.admin_list_users(text, text, int, int)',
    'public.admin_adjust_wallet(uuid, bigint, text)', 'public.decline_proposal(bigint)', 'public.hire_proposal(bigint)',
    'public.fund_contract(bigint)', 'public.submit_work(bigint, text)', 'public.request_revision(bigint, text)',
    'public.release_contract(bigint, int, text)', 'public.cancel_contract(bigint, text)', 'public.open_dispute(bigint, text, text)',
    'public.admin_resolve_dispute(bigint, text, bigint, text)', 'public.request_withdrawal(bigint, text, text, text)',
    'public.admin_process_withdrawal(bigint, boolean, text, text)', 'public.purchase_boost(text, text, int)',
    'public.create_ad_campaign(text, text, text, text, int, text)', 'public.admin_review_ad(bigint, boolean, text)',
    'public.admin_stats()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.record_ad_event(bigint, boolean) TO anon, authenticated;

-- =============================================================================
-- 10. Realtime for chats
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['support_messages', 'contract_messages', 'support_threads'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

SELECT 'admin + escrow migration complete' AS status, (SELECT require_signup_approval FROM app_settings) AS signup_approval_on;
