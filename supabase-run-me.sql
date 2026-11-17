-- AfriTalent: run this whole file once in Supabase → SQL Editor (safe to re-run).

-- AfriTalent: real notifications, KYC/address status sync, welcome message (2026-11-17)
-- Safe to re-run.

-- ───────────────────────── 1. Internal (trusted) writes may update protected profile columns
-- Triggers below set afri.trusted = on before syncing kyc/address status; clients can't set it.
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_trusted_write() AND NOT public.is_admin() THEN
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

-- ───────────────────────── 2. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'info',
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body       text CHECK (body IS NULL OR length(body) <= 2000),
  link       text CHECK (link IS NULL OR link ~ '^/'),
  ref        text,                        -- e.g. 'contract:12' — groups message notifications
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread ON public.notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;   -- users can only mark read

DROP POLICY IF EXISTS "Own notifications read" ON public.notifications;
CREATE POLICY "Own notifications read" ON public.notifications FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Own notifications mark read" ON public.notifications;
CREATE POLICY "Own notifications mark read" ON public.notifications FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Own notifications delete" ON public.notifications;
CREATE POLICY "Own notifications delete" ON public.notifications FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Internal helper — not callable through the API
CREATE OR REPLACE FUNCTION public.notify(p_user uuid, p_kind text, p_title text, p_body text DEFAULT NULL, p_link text DEFAULT NULL, p_ref text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  -- One unread notification per message thread is enough
  IF p_kind = 'message' AND p_ref IS NOT NULL AND EXISTS (
       SELECT 1 FROM notifications WHERE user_id = p_user AND ref = p_ref AND kind = 'message' AND read_at IS NULL) THEN
    RETURN;
  END IF;
  INSERT INTO notifications (user_id, kind, title, body, link, ref)
  VALUES (p_user, p_kind, left(p_title, 200), left(p_body, 2000), p_link, p_ref);
END $$;
REVOKE EXECUTE ON FUNCTION public.notify(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 3. KYC → profiles.kyc_status (+ notifications)
CREATE OR REPLACE FUNCTION public.kyc_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st   text := CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END;
  prev text := current_setting('afri.trusted', true);
BEGIN
  -- Only the newest submission decides the profile status
  IF EXISTS (SELECT 1 FROM kyc_verifications WHERE user_id = NEW.user_id AND id > NEW.id) THEN RETURN NEW; END IF;
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE profiles SET kyc_status = st WHERE id = NEW.user_id AND kyc_status IS DISTINCT FROM st;
  PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);

  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.submitted_at IS DISTINCT FROM NEW.submitted_at THEN
    IF st = 'approved' THEN
      PERFORM notify(NEW.user_id, 'kyc', 'Your identity is verified ✅', 'You can now send proposals, get hired and withdraw earnings.', '/dashboard');
    ELSIF st = 'rejected' THEN
      PERFORM notify(NEW.user_id, 'kyc', 'Your ID verification needs attention',
        COALESCE('Reason: ' || NEW.reviewer_note || '. ', '') || 'Please upload a clearer, valid document.', '/kyc');
    ELSIF TG_OP = 'INSERT' OR OLD.status = 'rejected' THEN
      PERFORM notify(NEW.user_id, 'kyc', 'ID documents received', 'Our team is reviewing your documents — usually within 24 hours. No further action is needed.', '/kyc');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kyc_after_write ON public.kyc_verifications;
CREATE TRIGGER kyc_after_write AFTER INSERT OR UPDATE OF status, submitted_at ON public.kyc_verifications
  FOR EACH ROW EXECUTE FUNCTION public.kyc_after_write();

-- ───────────────────────── 4. Address → profiles.address_status (+ notifications)
CREATE OR REPLACE FUNCTION public.address_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st   text := CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END;
  prev text := current_setting('afri.trusted', true);
BEGIN
  IF EXISTS (SELECT 1 FROM address_verifications WHERE user_id = NEW.user_id AND id > NEW.id) THEN RETURN NEW; END IF;
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE profiles SET address_status = st WHERE id = NEW.user_id AND address_status IS DISTINCT FROM st;
  PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);

  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    IF st = 'approved' THEN
      PERFORM notify(NEW.user_id, 'address', 'Your address is verified 📍', NULL, '/dashboard');
    ELSIF st = 'rejected' THEN
      PERFORM notify(NEW.user_id, 'address', 'Address verification needs attention', 'Please resubmit with a recent utility bill that shows your name and address.', '/verify-address');
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM notify(NEW.user_id, 'address', 'Address details received', 'We''ll let you know once your address is verified.', '/verify-address');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS address_after_write ON public.address_verifications;
CREATE TRIGGER address_after_write AFTER INSERT OR UPDATE OF status ON public.address_verifications
  FOR EACH ROW EXECUTE FUNCTION public.address_after_write();

-- Backfill: profiles whose submissions were never reflected
UPDATE public.profiles p SET kyc_status = CASE k.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END
FROM (SELECT DISTINCT ON (user_id) user_id, status FROM public.kyc_verifications ORDER BY user_id, id DESC) k
WHERE k.user_id = p.id AND p.kyc_status IS DISTINCT FROM (CASE k.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END);

UPDATE public.profiles p SET address_status = CASE a.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END
FROM (SELECT DISTINCT ON (user_id) user_id, status FROM public.address_verifications ORDER BY user_id, id DESC) a
WHERE a.user_id = p.id AND p.address_status IS DISTINCT FROM (CASE a.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END);

-- ───────────────────────── 5. Account status changes
CREATE OR REPLACE FUNCTION public.profile_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    IF NEW.account_status = 'active' AND OLD.account_status = 'pending' THEN
      PERFORM notify(NEW.id, 'account', 'Your account is approved 🎉', 'Posting, applying and payments are now unlocked.', '/dashboard');
    ELSIF NEW.account_status = 'active' THEN
      PERFORM notify(NEW.id, 'account', 'Your account has been restored', NULL, '/dashboard');
    ELSIF NEW.account_status IN ('suspended', 'blocked', 'rejected') THEN
      PERFORM notify(NEW.id, 'account', 'Your account is ' || NEW.account_status,
        COALESCE('Reason: ' || NEW.status_reason || '. ', '') || 'Contact support if you believe this is a mistake.', '/dashboard?tab=support');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profile_status_notify ON public.profiles;
CREATE TRIGGER profile_status_notify AFTER UPDATE OF account_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profile_status_notify();

-- ───────────────────────── 6. Gigs, proposals, contracts, messages
CREATE OR REPLACE FUNCTION public.proposal_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  SELECT id, client_id, title INTO g FROM gigs WHERE id = NEW.gig_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM notify(g.client_id, 'proposal', 'New proposal on "' || left(g.title, 80) || '"',
      (SELECT COALESCE(full_name, 'A freelancer') FROM profiles WHERE id = NEW.freelancer_id) || ' sent a proposal.', '/gigs/' || g.id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'declined' THEN
    PERFORM notify(NEW.freelancer_id, 'proposal', 'Proposal not selected', 'The client chose another proposal for "' || left(g.title, 80) || '". Keep applying!', '/gigs');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proposal_notify ON public.gig_proposals;
CREATE TRIGGER proposal_notify AFTER INSERT OR UPDATE OF status ON public.gig_proposals
  FOR EACH ROW EXECUTE FUNCTION public.proposal_notify();

CREATE OR REPLACE FUNCTION public.contract_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l text := '/contracts/' || NEW.id; t text := left(NEW.title, 80);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify(NEW.freelancer_id, 'contract', 'You''re hired! 🎉', 'You were hired for "' || t || '". Work starts once the client funds escrow.', l);
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  CASE NEW.status
    WHEN 'funded' THEN PERFORM notify(NEW.freelancer_id, 'contract', 'Escrow funded — start work', '"' || t || '" is funded and ready to begin.', l);
    WHEN 'submitted' THEN PERFORM notify(NEW.client_id, 'contract', 'Work submitted for review', 'Review the delivery for "' || t || '" and release payment or request changes.', l);
    WHEN 'revision_requested' THEN PERFORM notify(NEW.freelancer_id, 'contract', 'Changes requested', 'The client asked for changes on "' || t || '".', l);
    WHEN 'completed' THEN PERFORM notify(NEW.freelancer_id, 'payment', 'Payment released 💰', 'Earnings for "' || t || '" are in your wallet.', '/dashboard?tab=earnings');
    WHEN 'disputed' THEN
      PERFORM notify(NEW.client_id, 'contract', 'Dispute opened', '"' || t || '" is under review by AfriTalent.', l);
      PERFORM notify(NEW.freelancer_id, 'contract', 'Dispute opened', '"' || t || '" is under review by AfriTalent.', l);
    WHEN 'cancelled', 'refunded', 'settled' THEN
      PERFORM notify(NEW.client_id, 'contract', 'Contract ' || NEW.status, '"' || t || '"', l);
      PERFORM notify(NEW.freelancer_id, 'contract', 'Contract ' || NEW.status, '"' || t || '"', l);
    ELSE NULL;
  END CASE;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contract_notify ON public.contracts;
CREATE TRIGGER contract_notify AFTER INSERT OR UPDATE OF status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contract_notify();

CREATE OR REPLACE FUNCTION public.contract_message_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; who text;
BEGIN
  IF NEW.kind = 'system' THEN RETURN NEW; END IF;
  SELECT id, client_id, freelancer_id, title INTO c FROM contracts WHERE id = NEW.contract_id;
  who := CASE WHEN NEW.kind = 'admin' THEN 'AfriTalent support' ELSE COALESCE((SELECT full_name FROM profiles WHERE id = NEW.sender_id), 'Someone') END;
  IF NEW.sender_id IS DISTINCT FROM c.client_id THEN
    PERFORM notify(c.client_id, 'message', 'New message from ' || who, left(NEW.body, 140), '/messages?thread=contract-' || c.id, 'contract:' || c.id);
  END IF;
  IF NEW.sender_id IS DISTINCT FROM c.freelancer_id THEN
    PERFORM notify(c.freelancer_id, 'message', 'New message from ' || who, left(NEW.body, 140), '/messages?thread=contract-' || c.id, 'contract:' || c.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contract_message_notify ON public.contract_messages;
CREATE TRIGGER contract_message_notify AFTER INSERT ON public.contract_messages
  FOR EACH ROW EXECUTE FUNCTION public.contract_message_notify();

-- Support replies
CREATE OR REPLACE FUNCTION public.support_message_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE th record;
BEGIN
  IF NOT NEW.from_admin THEN RETURN NEW; END IF;
  SELECT id, user_id, subject, category INTO th FROM support_threads WHERE id = NEW.thread_id;
  IF th.category = 'welcome' THEN RETURN NEW; END IF;   -- the welcome has its own notification
  PERFORM notify(th.user_id, 'message', 'AfriTalent support replied', left(NEW.body, 140), '/messages?thread=support-' || th.id, 'support:' || th.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_message_notify ON public.support_messages;
CREATE TRIGGER support_message_notify AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_message_notify();

-- Internal (trusted) inserts keep the sender / from_admin they were given — used by the welcome message
CREATE OR REPLACE FUNCTION public.support_message_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('afri.trusted', true), '') = 'on' THEN RETURN NEW; END IF;
  NEW.sender_id := COALESCE(auth.uid(), NEW.sender_id);
  NEW.from_admin := public.is_admin() AND NOT EXISTS (SELECT 1 FROM support_threads WHERE id = NEW.thread_id AND user_id = auth.uid());
  RETURN NEW;
END $$;

-- Withdrawals and business claims
CREATE OR REPLACE FUNCTION public.withdrawal_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('paid', 'rejected', 'failed') THEN
    PERFORM notify(NEW.user_id, 'payment',
      CASE NEW.status WHEN 'paid' THEN 'Withdrawal paid 🏦' ELSE 'Withdrawal not completed' END,
      CASE NEW.status WHEN 'paid' THEN 'Your payout has been sent' || COALESCE(' (ref ' || NEW.payout_reference || ')', '') || '.'
           ELSE COALESCE(NEW.admin_note, 'The amount has been returned to your wallet.') END,
      '/dashboard?tab=wallet');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS withdrawal_notify ON public.withdrawal_requests;
CREATE TRIGGER withdrawal_notify AFTER UPDATE OF status ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.withdrawal_notify();

CREATE OR REPLACE FUNCTION public.claim_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    PERFORM notify(NEW.user_id, 'business',
      CASE NEW.status WHEN 'approved' THEN 'Business claim approved 🏢' ELSE 'Business claim not approved' END,
      CASE NEW.status WHEN 'approved' THEN 'You can now manage this business profile.' ELSE COALESCE(NEW.reviewer_note, 'Contact support for details.') END,
      '/businesses/' || NEW.company_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS claim_notify ON public.company_claims;
CREATE TRIGGER claim_notify AFTER UPDATE OF status ON public.company_claims
  FOR EACH ROW EXECUTE FUNCTION public.claim_notify();

-- ───────────────────────── 7. Welcome message for every new user
CREATE OR REPLACE FUNCTION public.send_welcome(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pr record; admin_id uuid; tid bigint; first text; tips text;
  prev text := current_setting('afri.trusted', true);
BEGIN
  IF EXISTS (SELECT 1 FROM support_threads WHERE user_id = p_user AND category = 'welcome') THEN RETURN; END IF;
  SELECT id, full_name, user_type, role INTO pr FROM profiles WHERE id = p_user;
  IF NOT FOUND OR pr.role = 'admin' THEN RETURN; END IF;
  SELECT id INTO admin_id FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  first := COALESCE(NULLIF(split_part(btrim(pr.full_name), ' ', 1), ''), 'there');

  tips := CASE WHEN pr.user_type IN ('business', 'recruiter') THEN
'Here''s how to get the most out of AfriTalent as an employer:

1. Verify your business — upload your ID and CAC certificate under Verify identity. Verified businesses get the "Verified" badge and more applicants.
2. Claim your business page — search Businesses; if your company is listed, click "Claim this business" to manage its profile and reviews.
3. Post jobs and gigs — use "Post a job" for full-time roles and "Post a gig" for freelance work. Gig payments are held safely in escrow until you approve the work.
4. Fund your wallet — top up from Dashboard → Wallet to fund escrow, boost listings and run ads.
5. Hire with confidence — compare proposals, check reviews, chat with candidates in Messages, then release payment only when you''re happy.
6. Boost visibility — feature your jobs, gigs or business page from Dashboard → Ads & boosts.'
  ELSE
'Here''s how to get the most out of AfriTalent:

1. Complete your profile — add a clear photo, your headline and skills. Complete profiles get far more views.
2. Verify your identity and address — verified members can send proposals, get hired and withdraw earnings.
3. Upload your CV — we''ll match you to the best roles automatically (Matches).
4. Explore jobs — 1,800+ live roles from employers'' own career pages, LinkedIn, MyJobMag and more, updated every hour. Look for the "Direct from employer" badge.
5. Win gigs — browse Gigs, send a tailored proposal and get paid securely through escrow. Your earnings appear under Dashboard → Earnings.
6. Research employers — read and write honest company reviews before you apply.'
  END;

  PERFORM set_config('afri.trusted', 'on', true);
  INSERT INTO support_threads (user_id, subject, category, status, last_message_at)
  VALUES (p_user, 'Welcome to AfriTalent 👋', 'welcome', 'open', now()) RETURNING id INTO tid;
  IF admin_id IS NOT NULL THEN
    INSERT INTO support_messages (thread_id, sender_id, from_admin, body)
    VALUES (tid, admin_id, true, left('Hi ' || first || ', welcome to AfriTalent — Africa''s verified professional network! 🎉

' || tips || '

Need help? Just reply to this message and our team will get back to you.

— The AfriTalent Team', 4000));
  END IF;
  PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);

  PERFORM notify(p_user, 'welcome', 'Welcome to AfriTalent, ' || first || '! 👋',
    'We''ve sent you a message with tips to get started.', '/messages?thread=support-' || tid);
END $$;
REVOKE EXECUTE ON FUNCTION public.send_welcome(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.profile_welcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM send_welcome(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'welcome message failed for %: %', NEW.id, SQLERRM;   -- never block a sign-up
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profile_welcome ON public.profiles;
CREATE TRIGGER profile_welcome AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profile_welcome();

REVOKE EXECUTE ON FUNCTION public.kyc_after_write(), public.address_after_write(), public.profile_status_notify(),
  public.proposal_notify(), public.contract_notify(), public.contract_message_notify(), public.support_message_notify(),
  public.withdrawal_notify(), public.claim_notify(), public.profile_welcome() FROM PUBLIC, anon, authenticated;

-- Welcome existing members who never got one
SELECT public.send_welcome(id) FROM public.profiles WHERE role IS DISTINCT FROM 'admin';

-- AfriTalent: public profiles, posts & portfolio, follows, likes, comments, news feed,
-- marketplace orders with escrow, and dashboard summary (2026-11-17).
-- Requires supabase-notifications-migration.sql (the notify() helper). Safe to re-run.

DO $$ BEGIN
  IF to_regprocedure('public.notify(uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Run supabase-notifications-migration.sql first';
  END IF;
END $$;

-- ───────────────────────── 1. Profile fields for the public, shareable profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS followers_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_-]{2,29}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_text_lengths CHECK (
    coalesce(length(headline), 0) <= 140 AND coalesce(length(bio), 0) <= 2000 AND coalesce(length(profession), 0) <= 80
    AND coalesce(length(location), 0) <= 120 AND (website IS NULL OR website ~ '^https?://') AND cardinality(skills) <= 30 AND cardinality(interests) <= 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (username);

CREATE OR REPLACE FUNCTION public.make_username(p_name text, p_id uuid)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE base text; cand text; n int := 0;
BEGIN
  base := left(trim(both '-' from regexp_replace(lower(coalesce(nullif(p_name, ''), 'member')), '[^a-z0-9]+', '-', 'g')), 20);
  IF length(base) < 3 THEN base := 'member'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM profiles WHERE username = cand AND id <> p_id) LOOP
    n := n + 1;
    cand := base || '-' || CASE WHEN n = 1 THEN left(replace(p_id::text, '-', ''), 4) ELSE left(md5(p_id::text || n), 5) END;
  END LOOP;
  RETURN cand;
END $$;

CREATE OR REPLACE FUNCTION public.profiles_username_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.username IS NULL OR NEW.username = '' THEN
    NEW.username := make_username(NEW.full_name, NEW.id);
  ELSE
    NEW.username := lower(NEW.username);
  END IF;
  -- counters are maintained by triggers only
  IF TG_OP = 'UPDATE' AND NOT public.is_trusted_write() THEN
    NEW.followers_count := OLD.followers_count; NEW.following_count := OLD.following_count; NEW.posts_count := OLD.posts_count;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_username_default ON public.profiles;
CREATE TRIGGER profiles_username_default BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_username_default();

UPDATE public.profiles SET username = public.make_username(full_name, id) WHERE username IS NULL;

-- ───────────────────────── 2. Follows
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS follows_following ON public.follows (following_id);
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.follows TO anon, authenticated;
GRANT INSERT, DELETE ON public.follows TO authenticated;
DROP POLICY IF EXISTS "Follows are public" ON public.follows;
CREATE POLICY "Follows are public" ON public.follows FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Follow as yourself" ON public.follows;
CREATE POLICY "Follow as yourself" ON public.follows FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = follower_id AND public.is_active_user());
DROP POLICY IF EXISTS "Unfollow as yourself" ON public.follows;
CREATE POLICY "Unfollow as yourself" ON public.follows FOR DELETE TO authenticated USING ((SELECT auth.uid()) = follower_id);

CREATE OR REPLACE FUNCTION public.follows_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev text := current_setting('afri.trusted', true); d int := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END;
        r public.follows := CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
BEGIN
  PERFORM set_config('afri.trusted', 'on', true);
  UPDATE profiles SET followers_count = greatest(0, followers_count + d) WHERE id = r.following_id;
  UPDATE profiles SET following_count = greatest(0, following_count + d) WHERE id = r.follower_id;
  PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);
  IF TG_OP = 'INSERT' THEN
    PERFORM notify(r.following_id, 'follow',
      COALESCE((SELECT full_name FROM profiles WHERE id = r.follower_id), 'Someone') || ' started following you',
      NULL, '/u/' || (SELECT username FROM profiles WHERE id = r.follower_id));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS follows_after_change ON public.follows;
CREATE TRIGGER follows_after_change AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.follows_after_change();

-- ───────────────────────── 3. Posts (updates, portfolio, jobs, services, products)
CREATE TABLE IF NOT EXISTS public.posts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  kind           text NOT NULL DEFAULT 'update' CHECK (kind IN ('update', 'portfolio', 'job', 'service', 'product')),
  title          text CHECK (title IS NULL OR length(title) BETWEEN 2 AND 140),
  body           text CHECK (body IS NULL OR length(body) <= 5000),
  media          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(media) = 'array' AND jsonb_array_length(media) <= 10),
  tags           text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 15),
  price          bigint CHECK (price IS NULL OR price > 0),            -- minor units
  currency       text NOT NULL DEFAULT 'NGN',
  stock          integer CHECK (stock IS NULL OR stock >= 0),          -- NULL = unlimited (services)
  delivery_days  integer CHECK (delivery_days IS NULL OR delivery_days BETWEEN 1 AND 180),
  location       text CHECK (location IS NULL OR length(location) <= 120),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold_out', 'hidden', 'removed')),
  likes_count    integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR title IS NOT NULL OR jsonb_array_length(media) > 0),
  CHECK (kind NOT IN ('product', 'service') OR (title IS NOT NULL AND price IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS posts_created ON public.posts (created_at DESC) WHERE status IN ('active', 'sold_out');
CREATE INDEX IF NOT EXISTS posts_author ON public.posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_market ON public.posts (kind, created_at DESC) WHERE kind IN ('product', 'service') AND status = 'active';
CREATE INDEX IF NOT EXISTS posts_tags ON public.posts USING gin (tags);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.posts TO authenticated;
DROP POLICY IF EXISTS "Posts visible" ON public.posts;
CREATE POLICY "Posts visible" ON public.posts FOR SELECT TO anon, authenticated
  USING (status IN ('active', 'sold_out') OR author_id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "Post as yourself" ON public.posts;
CREATE POLICY "Post as yourself" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND public.is_active_user());
DROP POLICY IF EXISTS "Edit own posts" ON public.posts;
CREATE POLICY "Edit own posts" ON public.posts FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR public.is_admin()) WITH CHECK (author_id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "Delete own posts" ON public.posts;
CREATE POLICY "Delete own posts" ON public.posts FOR DELETE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.posts_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m jsonb;
BEGIN
  IF NOT public.is_trusted_write() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.author_id := auth.uid(); NEW.likes_count := 0; NEW.comments_count := 0; NEW.created_at := now();
    ELSE
      NEW.author_id := OLD.author_id; NEW.likes_count := OLD.likes_count; NEW.comments_count := OLD.comments_count; NEW.created_at := OLD.created_at;
      IF OLD.status = 'removed' AND NOT public.is_admin() THEN NEW.status := 'removed'; END IF;
    END IF;
    IF NEW.status = 'removed' AND NOT public.is_admin() THEN NEW.status := COALESCE(OLD.status, 'hidden'); END IF;
  END IF;
  NEW.updated_at := now();
  NEW.tags := ARRAY(SELECT DISTINCT left(lower(btrim(t)), 30) FROM unnest(NEW.tags) t WHERE btrim(t) <> '');
  -- media: [{ "url": "https://…", "type": "image"|"video" }]
  FOR m IN SELECT * FROM jsonb_array_elements(NEW.media) LOOP
    IF (m->>'url') !~ '^https://' OR (m->>'type') NOT IN ('image', 'video') THEN
      RAISE EXCEPTION 'Invalid media item';
    END IF;
  END LOOP;
  IF NEW.kind IN ('product') AND NEW.stock = 0 AND NEW.status = 'active' THEN NEW.status := 'sold_out'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS posts_before_write ON public.posts;
CREATE TRIGGER posts_before_write BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_before_write();

CREATE OR REPLACE FUNCTION public.posts_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev text := current_setting('afri.trusted', true); a record; label text;
BEGIN
  PERFORM set_config('afri.trusted', 'on', true);
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET posts_count = posts_count + 1 WHERE id = NEW.author_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET posts_count = greatest(0, posts_count - 1) WHERE id = OLD.author_id;
  END IF;
  PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    SELECT full_name, username INTO a FROM profiles WHERE id = NEW.author_id;
    label := CASE NEW.kind WHEN 'product' THEN 'listed a new product' WHEN 'service' THEN 'is offering a new service'
      WHEN 'job' THEN 'posted a job' WHEN 'portfolio' THEN 'added new work to their portfolio' ELSE 'shared a new post' END;
    -- tell followers (most recent 500)
    PERFORM notify(f.follower_id, 'post', COALESCE(a.full_name, 'Someone you follow') || ' ' || label,
      left(COALESCE(NEW.title, NEW.body, ''), 140), '/posts/' || NEW.id, 'post:' || NEW.id)
    FROM (SELECT follower_id FROM follows WHERE following_id = NEW.author_id ORDER BY created_at DESC LIMIT 500) f;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS posts_after_change ON public.posts;
CREATE TRIGGER posts_after_change AFTER INSERT OR DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_after_change();

-- ───────────────────────── 4. Likes & comments
CREATE TABLE IF NOT EXISTS public.post_likes (
  post_id    bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_likes_user ON public.post_likes (user_id);
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.post_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_likes TO authenticated;
DROP POLICY IF EXISTS "Likes are public" ON public.post_likes;
CREATE POLICY "Likes are public" ON public.post_likes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Like as yourself" ON public.post_likes;
CREATE POLICY "Like as yourself" ON public.post_likes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_active_user());
DROP POLICY IF EXISTS "Unlike as yourself" ON public.post_likes;
CREATE POLICY "Unlike as yourself" ON public.post_likes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.post_comments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id    bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_comments_post ON public.post_comments (post_id, created_at);
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.post_comments TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_comments TO authenticated;
DROP POLICY IF EXISTS "Comments on visible posts" ON public.post_comments;
CREATE POLICY "Comments on visible posts" ON public.post_comments FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_id));
DROP POLICY IF EXISTS "Comment as yourself" ON public.post_comments;
CREATE POLICY "Comment as yourself" ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND public.is_active_user()
              AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_id AND p.status IN ('active', 'sold_out')));
DROP POLICY IF EXISTS "Delete own or on own post" ON public.post_comments;
CREATE POLICY "Delete own or on own post" ON public.post_comments FOR DELETE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR public.is_admin()
         OR EXISTS (SELECT 1 FROM posts p WHERE p.id = post_id AND p.author_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.post_reaction_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev text := current_setting('afri.trusted', true); pid bigint; actor uuid; p record; who text;
BEGIN
  pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  PERFORM set_config('afri.trusted', 'on', true);
  IF TG_TABLE_NAME = 'post_likes' THEN
    UPDATE posts SET likes_count = greatest(0, likes_count + CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END) WHERE id = pid;
  ELSE
    UPDATE posts SET comments_count = greatest(0, comments_count + CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END) WHERE id = pid;
  END IF;
  PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);

  IF TG_OP = 'INSERT' THEN
    actor := (to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'post_likes' THEN 'user_id' ELSE 'author_id' END)::uuid;
    SELECT id, author_id, COALESCE(title, left(body, 60), 'your post') AS label INTO p FROM posts WHERE id = pid;
    who := COALESCE((SELECT full_name FROM profiles WHERE id = actor), 'Someone');
    IF p.author_id <> actor THEN
      IF TG_TABLE_NAME = 'post_likes' THEN
        PERFORM notify(p.author_id, 'like', who || ' liked "' || left(p.label, 60) || '"', NULL, '/posts/' || pid, 'like:' || pid);
      ELSE
        PERFORM notify(p.author_id, 'comment', who || ' commented on "' || left(p.label, 60) || '"', left(NEW.body, 140), '/posts/' || pid, 'comment:' || pid);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS post_likes_after_change ON public.post_likes;
CREATE TRIGGER post_likes_after_change AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.post_reaction_after_change();
DROP TRIGGER IF EXISTS post_comments_after_change ON public.post_comments;
CREATE TRIGGER post_comments_after_change AFTER INSERT OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.post_reaction_after_change();

-- Likes repeat on the same post → one unread notification is enough
CREATE OR REPLACE FUNCTION public.notify(p_user uuid, p_kind text, p_title text, p_body text DEFAULT NULL, p_link text DEFAULT NULL, p_ref text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  IF p_kind IN ('message', 'like', 'post') AND p_ref IS NOT NULL AND EXISTS (
       SELECT 1 FROM notifications WHERE user_id = p_user AND ref = p_ref AND kind = p_kind AND read_at IS NULL) THEN
    RETURN;
  END IF;
  INSERT INTO notifications (user_id, kind, title, body, link, ref)
  VALUES (p_user, p_kind, left(p_title, 200), left(p_body, 2000), p_link, p_ref);
END $$;
REVOKE EXECUTE ON FUNCTION public.notify(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 5. Media storage (public bucket, own folder only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('posts', 'posts', true, 52428800,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Post media upload own folder" ON storage.objects;
CREATE POLICY "Post media upload own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'posts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS "Post media delete own" ON storage.objects;
CREATE POLICY "Post media delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'posts' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- ───────────────────────── 6. Marketplace orders (escrow until delivery)
CREATE TABLE IF NOT EXISTS public.orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id          bigint REFERENCES public.posts(id) ON DELETE SET NULL,
  buyer_id         uuid NOT NULL REFERENCES public.profiles(id),
  seller_id        uuid NOT NULL REFERENCES public.profiles(id),
  kind             text NOT NULL CHECK (kind IN ('product', 'service')),
  title            text NOT NULL,
  quantity         integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price       bigint NOT NULL CHECK (unit_price > 0),
  amount           bigint NOT NULL CHECK (amount > 0),
  fee_percent      numeric NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'NGN',
  status           text NOT NULL DEFAULT 'paid'
                   CHECK (status IN ('paid', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'disputed')),
  shipping_address text CHECK (shipping_address IS NULL OR length(shipping_address) <= 500),
  buyer_note       text CHECK (buyer_note IS NULL OR length(buyer_note) <= 1000),
  carrier          text,
  tracking_ref     text,
  receipt_url      text,
  seller_note      text,
  buyer_rating     integer CHECK (buyer_rating IS NULL OR buyer_rating BETWEEN 1 AND 5),
  buyer_review     text,
  dispute_reason   text,
  admin_note       text,
  auto_release_at  timestamptz,
  shipped_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS orders_buyer ON public.orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller ON public.orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_auto_release ON public.orders (auto_release_at) WHERE status = 'shipped';
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders FROM anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;      -- all changes go through the functions below
DROP POLICY IF EXISTS "Order parties read" ON public.orders;
CREATE POLICY "Order parties read" ON public.orders FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()) OR public.is_admin());

CREATE OR REPLACE FUNCTION public._order_notify(o public.orders, p_to uuid, p_title text, p_body text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.notify(p_to, 'order', p_title, p_body, '/orders/' || o.id);
$$;

CREATE OR REPLACE FUNCTION public.place_order(p_post bigint, p_quantity integer DEFAULT 1, p_address text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p posts%ROWTYPE; o orders%ROWTYPE; amt bigint; fee numeric; prev text := current_setting('afri.trusted', true);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in'; END IF;
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Your account is not active yet'; END IF;
  SELECT * INTO p FROM posts WHERE id = p_post FOR UPDATE;
  IF NOT FOUND OR p.kind NOT IN ('product', 'service') OR p.status <> 'active' OR p.price IS NULL THEN RAISE EXCEPTION 'This listing is not available'; END IF;
  IF p.author_id = auth.uid() THEN RAISE EXCEPTION 'You cannot buy your own listing'; END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  IF p.kind = 'product' THEN
    IF p.stock IS NOT NULL AND p.stock < p_quantity THEN RAISE EXCEPTION 'Only % left in stock', p.stock; END IF;
    IF p_address IS NULL OR length(btrim(p_address)) < 8 THEN RAISE EXCEPTION 'Enter a delivery address'; END IF;
  END IF;
  amt := p.price * p_quantity;
  SELECT platform_fee_percent INTO fee FROM app_settings WHERE id = 1;

  INSERT INTO orders (post_id, buyer_id, seller_id, kind, title, quantity, unit_price, amount, fee_percent, currency, status, shipping_address, buyer_note)
  VALUES (p.id, auth.uid(), p.author_id, p.kind, p.title, p_quantity, p.price, amt, COALESCE(fee, 0), p.currency, 'paid', btrim(p_address), btrim(p_note))
  RETURNING * INTO o;

  PERFORM public._wallet_apply(auth.uid(), -amt, amt, 0, 'escrow_hold', 'Order #' || o.id || ' (escrow): ' || p.title, NULL, 'order:' || o.id || ':hold');

  IF p.kind = 'product' AND p.stock IS NOT NULL THEN
    PERFORM set_config('afri.trusted', 'on', true);
    UPDATE posts SET stock = stock - p_quantity, status = CASE WHEN stock - p_quantity = 0 THEN 'sold_out' ELSE status END WHERE id = p.id;
    PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);
  END IF;

  PERFORM _order_notify(o, o.seller_id, 'New order: ' || left(o.title, 80) || ' 🛒',
    'Payment is held in escrow. ' || CASE WHEN o.kind = 'product' THEN 'Ship the item and add the tracking details or receipt.' ELSE 'Deliver the service and mark it delivered.' END);
  PERFORM _order_notify(o, o.buyer_id, 'Order placed — payment held in escrow', 'The seller is paid only after you confirm delivery.');
  RETURN o.id;
END $$;

CREATE OR REPLACE FUNCTION public.mark_order_shipped(p_order bigint, p_carrier text DEFAULT NULL, p_tracking text DEFAULT NULL, p_receipt_url text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.seller_id <> auth.uid() THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status <> 'paid' THEN RAISE EXCEPTION 'This order cannot be marked as shipped'; END IF;
  IF o.kind = 'product' AND COALESCE(btrim(p_tracking), '') = '' AND COALESCE(btrim(p_receipt_url), '') = '' THEN
    RAISE EXCEPTION 'Add a tracking number or upload the shipping receipt';
  END IF;
  IF p_receipt_url IS NOT NULL AND p_receipt_url !~ '^https://' THEN RAISE EXCEPTION 'Invalid receipt link'; END IF;
  UPDATE orders SET status = 'shipped', carrier = left(btrim(p_carrier), 80), tracking_ref = left(btrim(p_tracking), 120),
    receipt_url = p_receipt_url, seller_note = left(btrim(p_note), 1000), shipped_at = now(),
    auto_release_at = now() + interval '14 days', updated_at = now()
  WHERE id = o.id RETURNING * INTO o;
  PERFORM _order_notify(o, o.buyer_id,
    CASE WHEN o.kind = 'product' THEN 'Your order has shipped 🚚' ELSE 'Your service has been delivered' END,
    'Confirm delivery once you receive it to release payment. Funds release automatically in 14 days if there is no dispute.');
END $$;

CREATE OR REPLACE FUNCTION public._release_order(o public.orders, p_by text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fee bigint := round(o.amount * o.fee_percent / 100);
BEGIN
  PERFORM public._wallet_apply(o.buyer_id, 0, -o.amount, 0, 'escrow_release', 'Order #' || o.id || ' released: ' || o.title, NULL, 'order:' || o.id || ':release');
  PERFORM public._wallet_apply(o.seller_id, o.amount - fee, 0, 0, 'earning', 'Sale: ' || o.title || ' (order #' || o.id || ')', NULL, 'order:' || o.id || ':earning',
    jsonb_build_object('gross', o.amount, 'fee', fee, 'order_id', o.id));
  IF fee > 0 THEN INSERT INTO platform_ledger (type, amount, user_id, reference) VALUES ('fee', fee, o.seller_id, 'order:' || o.id); END IF;
  UPDATE orders SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = o.id;
  PERFORM _order_notify(o, o.seller_id, 'Payment released 💰', 'Earnings for "' || left(o.title, 80) || '" are in your wallet' || CASE WHEN p_by = 'auto' THEN ' (auto-released).' ELSE '.' END);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order bigint, p_rating integer DEFAULT NULL, p_review text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.buyer_id <> auth.uid() THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status NOT IN ('paid', 'shipped', 'delivered') THEN RAISE EXCEPTION 'This order cannot be confirmed'; END IF;
  UPDATE orders SET buyer_rating = CASE WHEN p_rating BETWEEN 1 AND 5 THEN p_rating END, buyer_review = left(btrim(p_review), 2000)
  WHERE id = o.id RETURNING * INTO o;
  PERFORM public._release_order(o, 'buyer');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order bigint, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE; prev text := current_setting('afri.trusted', true);
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (o.buyer_id, o.seller_id) THEN RAISE EXCEPTION 'Order not found'; END IF;
  -- buyers can cancel before shipping; sellers can cancel (refund) any time before completion
  IF NOT (o.status = 'paid' OR (auth.uid() = o.seller_id AND o.status IN ('shipped', 'delivered'))) THEN
    RAISE EXCEPTION 'This order can no longer be cancelled — open a dispute instead';
  END IF;
  PERFORM public._wallet_apply(o.buyer_id, o.amount, -o.amount, 0, 'escrow_refund', 'Order #' || o.id || ' refunded: ' || o.title, NULL, 'order:' || o.id || ':refund');
  UPDATE orders SET status = 'cancelled', cancelled_at = now(), seller_note = COALESCE(left(btrim(p_reason), 1000), seller_note), updated_at = now()
  WHERE id = o.id RETURNING * INTO o;
  IF o.kind = 'product' AND o.post_id IS NOT NULL THEN
    PERFORM set_config('afri.trusted', 'on', true);
    UPDATE posts SET stock = stock + o.quantity, status = CASE WHEN status = 'sold_out' THEN 'active' ELSE status END WHERE id = o.post_id AND stock IS NOT NULL;
    PERFORM set_config('afri.trusted', COALESCE(prev, 'off'), true);
  END IF;
  PERFORM _order_notify(o, CASE WHEN auth.uid() = o.buyer_id THEN o.seller_id ELSE o.buyer_id END,
    'Order cancelled: ' || left(o.title, 80), 'The payment was refunded to the buyer''s wallet.' || COALESCE(' Reason: ' || p_reason, ''));
END $$;

CREATE OR REPLACE FUNCTION public.dispute_order(p_order bigint, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (o.buyer_id, o.seller_id) THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.status NOT IN ('paid', 'shipped', 'delivered') THEN RAISE EXCEPTION 'This order cannot be disputed'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Describe the problem (at least 10 characters)'; END IF;
  UPDATE orders SET status = 'disputed', dispute_reason = left(btrim(p_reason), 2000), auto_release_at = NULL, updated_at = now()
  WHERE id = o.id RETURNING * INTO o;
  PERFORM _order_notify(o, CASE WHEN auth.uid() = o.buyer_id THEN o.seller_id ELSE o.buyer_id END,
    'Dispute opened on order #' || o.id, 'Funds stay in escrow while AfriTalent reviews it.');
  PERFORM notify(a.id, 'order', 'Order dispute #' || o.id || ' needs review', left(p_reason, 140), '/orders/' || o.id)
  FROM profiles a WHERE a.role = 'admin';
END $$;

CREATE OR REPLACE FUNCTION public.admin_resolve_order(p_order bigint, p_refund boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('paid', 'shipped', 'delivered', 'disputed') THEN RAISE EXCEPTION 'Order is not open'; END IF;
  UPDATE orders SET admin_note = left(p_note, 2000) WHERE id = o.id RETURNING * INTO o;
  IF p_refund THEN
    PERFORM public._wallet_apply(o.buyer_id, o.amount, -o.amount, 0, 'escrow_refund', 'Order #' || o.id || ' refunded by AfriTalent', NULL, 'order:' || o.id || ':refund');
    UPDATE orders SET status = 'refunded', cancelled_at = now(), updated_at = now() WHERE id = o.id;
    PERFORM _order_notify(o, o.buyer_id, 'Order #' || o.id || ' refunded', p_note);
    PERFORM _order_notify(o, o.seller_id, 'Order #' || o.id || ' was refunded to the buyer', p_note);
  ELSE
    PERFORM public._release_order(o, 'admin');
    PERFORM _order_notify(o, o.buyer_id, 'Dispute resolved: payment released to the seller', p_note);
  END IF;
  INSERT INTO admin_actions (admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), CASE WHEN p_refund THEN 'order_refund' ELSE 'order_release' END, 'order', o.id::text,
          jsonb_build_object('buyer', o.buyer_id, 'seller', o.seller_id, 'amount', o.amount, 'note', p_note));
END $$;

-- Hourly job (sync script / cron, service role): release shipped orders nobody disputed within 14 days
CREATE OR REPLACE FUNCTION public.release_due_orders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o orders%ROWTYPE; n int := 0;
BEGIN
  FOR o IN SELECT * FROM orders WHERE status = 'shipped' AND auto_release_at <= now() ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
    PERFORM public._release_order(o, 'auto');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ───────────────────────── 7. Read APIs (safe public columns only)
CREATE OR REPLACE FUNCTION public.public_people(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text, username text, avatar_url text, headline text, profession text, verified boolean, user_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.username, p.avatar_url, p.headline, p.profession, p.kyc_status = 'approved', p.user_type
  FROM profiles p WHERE p.id = ANY (p_ids[1:200]) AND p.account_status NOT IN ('blocked', 'rejected');
$$;

CREATE OR REPLACE FUNCTION public.get_public_profile(p_handle text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p profiles%ROWTYPE; me uuid := auth.uid();
BEGIN
  SELECT * INTO p FROM profiles WHERE username = lower(p_handle) OR id::text = p_handle LIMIT 1;
  IF NOT FOUND OR p.account_status IN ('blocked', 'rejected') OR (NOT p.is_public AND p.id IS DISTINCT FROM me) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'cover_url', p.cover_url,
    'headline', p.headline, 'bio', p.bio, 'profession', p.profession, 'location', p.location, 'website', p.website,
    'skills', p.skills, 'user_type', p.user_type, 'member_since', p.created_at,
    'kyc_verified', p.kyc_status = 'approved', 'address_verified', p.address_status = 'approved',
    'followers', p.followers_count, 'following', p.following_count, 'posts', p.posts_count,
    'is_me', p.id = me,
    'is_following', EXISTS (SELECT 1 FROM follows WHERE follower_id = me AND following_id = p.id),
    'rating', (SELECT round(avg(r)::numeric, 1) FROM (
        SELECT client_rating r FROM contracts WHERE freelancer_id = p.id AND client_rating IS NOT NULL
        UNION ALL SELECT buyer_rating FROM orders WHERE seller_id = p.id AND buyer_rating IS NOT NULL) x),
    'ratings_count', (SELECT count(*) FROM contracts WHERE freelancer_id = p.id AND client_rating IS NOT NULL)
                   + (SELECT count(*) FROM orders WHERE seller_id = p.id AND buyer_rating IS NOT NULL),
    'jobs_completed', (SELECT count(*) FROM contracts WHERE freelancer_id = p.id AND status = 'completed')
                    + (SELECT count(*) FROM orders WHERE seller_id = p.id AND status = 'completed'),
    'reviews', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
        SELECT jsonb_build_object('rating', c.client_rating, 'text', c.client_review, 'title', c.title, 'at', c.completed_at) x
        FROM contracts c WHERE c.freelancer_id = p.id AND c.client_rating IS NOT NULL
        UNION ALL
        SELECT jsonb_build_object('rating', o.buyer_rating, 'text', o.buyer_review, 'title', o.title, 'at', o.completed_at)
        FROM orders o WHERE o.seller_id = p.id AND o.buyer_rating IS NOT NULL
        LIMIT 20) r), '[]'::jsonb)
  );
END $$;

-- Feed rows with author details and "liked by me"
CREATE OR REPLACE FUNCTION public.get_feed(p_scope text DEFAULT 'for_you', p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 20,
                                           p_author uuid DEFAULT NULL, p_kinds text[] DEFAULT NULL, p_search text DEFAULT NULL)
RETURNS TABLE (id bigint, author_id uuid, kind text, title text, body text, media jsonb, tags text[], price bigint, currency text,
               stock integer, delivery_days integer, location text, status text, likes_count integer, comments_count integer,
               created_at timestamptz, author_name text, author_username text, author_avatar text, author_headline text,
               author_verified boolean, liked boolean, following boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS uid),
       mine AS (SELECT COALESCE(interests, '{}') || COALESCE(skills, '{}') AS tags FROM profiles WHERE id = (SELECT uid FROM me)),
       fol AS (SELECT following_id FROM follows WHERE follower_id = (SELECT uid FROM me))
  SELECT p.id, p.author_id, p.kind, p.title, p.body, p.media, p.tags, p.price, p.currency, p.stock, p.delivery_days, p.location,
         p.status, p.likes_count, p.comments_count, p.created_at,
         a.full_name, a.username, a.avatar_url, a.headline, a.kyc_status = 'approved',
         EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = (SELECT uid FROM me)),
         p.author_id IN (SELECT following_id FROM fol)
  FROM posts p JOIN profiles a ON a.id = p.author_id
  WHERE (p.status IN ('active', 'sold_out') OR p.author_id = (SELECT uid FROM me))
    AND p.status <> 'removed'
    AND a.account_status NOT IN ('blocked', 'rejected')
    AND (p_before IS NULL OR p.created_at < p_before)
    AND (p_author IS NULL OR p.author_id = p_author)
    AND (p_kinds IS NULL OR p.kind = ANY (p_kinds))
    AND (p_search IS NULL OR p.title ILIKE '%' || p_search || '%' OR p.body ILIKE '%' || p_search || '%' OR lower(p_search) = ANY (p.tags))
    AND CASE p_scope
          WHEN 'following' THEN p.author_id IN (SELECT following_id FROM fol) OR p.author_id = (SELECT uid FROM me)
          WHEN 'market' THEN p.kind IN ('product', 'service') AND p.status = 'active'
          ELSE true
        END
  ORDER BY
    -- "for you": people you follow and your interests first within the same day, then newest
    CASE WHEN p_scope = 'for_you' THEN date_trunc('day', p.created_at) END DESC NULLS LAST,
    CASE WHEN p_scope = 'for_you' THEN (p.author_id IN (SELECT following_id FROM fol))::int
                                     + (p.tags && COALESCE((SELECT tags FROM mine), '{}'))::int END DESC NULLS LAST,
    p.created_at DESC
  LIMIT least(greatest(p_limit, 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.get_post_comments(p_post bigint)
RETURNS TABLE (id bigint, body text, created_at timestamptz, author_id uuid, author_name text, author_username text, author_avatar text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.body, c.created_at, c.author_id, a.full_name, a.username, a.avatar_url
  FROM post_comments c JOIN profiles a ON a.id = c.author_id
  WHERE c.post_id = p_post AND EXISTS (SELECT 1 FROM posts p WHERE p.id = p_post AND (p.status IN ('active', 'sold_out') OR p.author_id = auth.uid()))
  ORDER BY c.created_at
  LIMIT 300;
$$;

-- Dashboard overview for the signed-in user
CREATE OR REPLACE FUNCTION public.dashboard_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'wallet', (SELECT jsonb_build_object('balance', balance, 'held', held, 'pending_withdrawal', pending_withdrawal, 'currency', currency) FROM wallets WHERE user_id = me),
    'earned_total', COALESCE((SELECT sum(amount) FROM wallet_transactions WHERE user_id = me AND type = 'earning'), 0),
    'earned_30d', COALESCE((SELECT sum(amount) FROM wallet_transactions WHERE user_id = me AND type = 'earning' AND created_at > now() - interval '30 days'), 0),
    'spent_total', COALESCE((SELECT sum(-held_change) FROM wallet_transactions WHERE user_id = me AND type = 'escrow_release'), 0),
    'rating', (SELECT round(avg(r)::numeric, 1) FROM (
        SELECT client_rating r FROM contracts WHERE freelancer_id = me AND client_rating IS NOT NULL
        UNION ALL SELECT buyer_rating FROM orders WHERE seller_id = me AND buyer_rating IS NOT NULL) x),
    'ratings_count', (SELECT count(*) FROM contracts WHERE freelancer_id = me AND client_rating IS NOT NULL)
                   + (SELECT count(*) FROM orders WHERE seller_id = me AND buyer_rating IS NOT NULL),
    'job_applications', (SELECT count(*) FROM applications WHERE user_id = me),
    'proposals_sent', (SELECT count(*) FROM gig_proposals WHERE freelancer_id = me),
    'proposals_accepted', (SELECT count(*) FROM gig_proposals WHERE freelancer_id = me AND status = 'accepted'),
    'gigs_posted', (SELECT count(*) FROM gigs WHERE client_id = me),
    'contracts_active', (SELECT count(*) FROM contracts WHERE me IN (client_id, freelancer_id) AND status IN ('awaiting_funding', 'funded', 'submitted', 'revision_requested', 'disputed')),
    'contracts_completed', (SELECT count(*) FROM contracts WHERE me IN (client_id, freelancer_id) AND status = 'completed'),
    'orders_bought', (SELECT count(*) FROM orders WHERE buyer_id = me),
    'orders_sold', (SELECT count(*) FROM orders WHERE seller_id = me),
    'orders_open', (SELECT count(*) FROM orders WHERE me IN (buyer_id, seller_id) AND status IN ('paid', 'shipped', 'delivered', 'disputed')),
    'sales_total', COALESCE((SELECT sum(amount) FROM orders WHERE seller_id = me AND status = 'completed'), 0),
    'posts', (SELECT posts_count FROM profiles WHERE id = me),
    'followers', (SELECT followers_count FROM profiles WHERE id = me),
    'following', (SELECT following_count FROM profiles WHERE id = me),
    'recent_transactions', COALESCE((SELECT jsonb_agg(t ORDER BY t.created_at DESC) FROM (
        SELECT id, type, amount, held_change, description, created_at FROM wallet_transactions WHERE user_id = me ORDER BY created_at DESC LIMIT 8) t), '[]'::jsonb),
    'recent_applications', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT a.created_at, j.id AS job_id, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = me ORDER BY a.created_at DESC LIMIT 5) x), '[]'::jsonb),
    'recent_proposals', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT gp.created_at, gp.status, gp.amount, g.id AS gig_id, g.title FROM gig_proposals gp JOIN gigs g ON g.id = gp.gig_id WHERE gp.freelancer_id = me ORDER BY gp.created_at DESC LIMIT 5) x), '[]'::jsonb),
    'recent_orders', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT id, title, amount, status, created_at, (buyer_id = me) AS bought FROM orders WHERE me IN (buyer_id, seller_id) ORDER BY created_at DESC LIMIT 5) x), '[]'::jsonb)
  );
END $$;

-- ───────────────────────── 8. Lock down internal helpers; expose the API functions
REVOKE EXECUTE ON FUNCTION public.make_username(text, uuid), public.profiles_username_default(), public.follows_after_change(),
  public.posts_before_write(), public.posts_after_change(), public.post_reaction_after_change(),
  public._order_notify(public.orders, uuid, text, text), public._release_order(public.orders, text), public.release_due_orders()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.place_order(bigint, integer, text, text), public.mark_order_shipped(bigint, text, text, text, text),
  public.confirm_order_delivery(bigint, integer, text), public.cancel_order(bigint, text), public.dispute_order(bigint, text),
  public.admin_resolve_order(bigint, boolean, text), public.dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(bigint, integer, text, text), public.mark_order_shipped(bigint, text, text, text, text),
  public.confirm_order_delivery(bigint, integer, text), public.cancel_order(bigint, text), public.dispute_order(bigint, text),
  public.admin_resolve_order(bigint, boolean, text), public.dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_due_orders() TO service_role;   -- hourly sync job
GRANT EXECUTE ON FUNCTION public.public_people(uuid[]), public.get_public_profile(text),
  public.get_feed(text, timestamptz, integer, uuid, text[], text), public.get_post_comments(bigint) TO anon, authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AfriTalent: reviews for every professional & business (max 3 per reviewer per target),
-- combined ratings, and site-wide search (people, businesses, jobs). 2026-11-17. Safe to re-run.
-- Requires supabase-notifications-migration.sql and supabase-social-marketplace-migration.sql.

-- ───────────────────────── 1. Reviews of members (professionals, freelancers, sellers, businesses' owners)
CREATE TABLE IF NOT EXISTS public.user_reviews (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewee_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text CHECK (title IS NULL OR length(title) <= 120),
  body         text NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 2000),
  relationship text NOT NULL DEFAULT 'customer' CHECK (relationship IN ('client', 'customer', 'employer', 'colleague', 'other')),
  verified     boolean NOT NULL DEFAULT false,      -- reviewer completed a contract or order with them
  hidden       boolean NOT NULL DEFAULT false,      -- moderated by an admin
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewer_id <> reviewee_id)
);
CREATE INDEX IF NOT EXISTS user_reviews_reviewee ON public.user_reviews (reviewee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reviews_pair ON public.user_reviews (reviewer_id, reviewee_id);

ALTER TABLE public.user_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_reviews TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_reviews TO authenticated;
DROP POLICY IF EXISTS "Reviews are public" ON public.user_reviews;
CREATE POLICY "Reviews are public" ON public.user_reviews FOR SELECT TO anon, authenticated
  USING (NOT hidden OR reviewer_id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "Review as yourself" ON public.user_reviews;
CREATE POLICY "Review as yourself" ON public.user_reviews FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = (SELECT auth.uid()) AND public.is_active_user());
DROP POLICY IF EXISTS "Edit own review" ON public.user_reviews;
CREATE POLICY "Edit own review" ON public.user_reviews FOR UPDATE TO authenticated
  USING (reviewer_id = (SELECT auth.uid()) OR public.is_admin()) WITH CHECK (reviewer_id = (SELECT auth.uid()) OR public.is_admin());
DROP POLICY IF EXISTS "Delete own review" ON public.user_reviews;
CREATE POLICY "Delete own review" ON public.user_reviews FOR DELETE TO authenticated
  USING (reviewer_id = (SELECT auth.uid()) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.user_reviews_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.is_client_request() THEN NEW.reviewer_id := auth.uid(); END IF;
    IF NEW.reviewer_id = NEW.reviewee_id THEN RAISE EXCEPTION 'You cannot review yourself'; END IF;
    -- Anti-targeting: at most 3 reviews by the same person for the same member
    IF (SELECT count(*) FROM user_reviews WHERE reviewer_id = NEW.reviewer_id AND reviewee_id = NEW.reviewee_id) >= 3 THEN
      RAISE EXCEPTION 'You can leave at most 3 reviews for the same person';
    END IF;
    -- Anti-spam: at most 10 reviews per reviewer per day
    IF (SELECT count(*) FROM user_reviews WHERE reviewer_id = NEW.reviewer_id AND created_at > now() - interval '1 day') >= 10 THEN
      RAISE EXCEPTION 'Daily review limit reached — please try again tomorrow';
    END IF;
    NEW.verified := EXISTS (SELECT 1 FROM contracts c WHERE c.status = 'completed'
                              AND ((c.client_id = NEW.reviewer_id AND c.freelancer_id = NEW.reviewee_id)
                                OR (c.freelancer_id = NEW.reviewer_id AND c.client_id = NEW.reviewee_id)))
                 OR EXISTS (SELECT 1 FROM orders o WHERE o.status = 'completed' AND o.buyer_id = NEW.reviewer_id AND o.seller_id = NEW.reviewee_id);
    NEW.hidden := false;
    NEW.created_at := now();
  ELSE
    NEW.reviewer_id := OLD.reviewer_id; NEW.reviewee_id := OLD.reviewee_id;
    NEW.verified := OLD.verified; NEW.created_at := OLD.created_at;
    IF NOT public.is_admin() THEN NEW.hidden := OLD.hidden; END IF;
  END IF;
  NEW.title := NULLIF(btrim(NEW.title), '');
  NEW.body := btrim(NEW.body);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_reviews_before_write ON public.user_reviews;
CREATE TRIGGER user_reviews_before_write BEFORE INSERT OR UPDATE ON public.user_reviews
  FOR EACH ROW EXECUTE FUNCTION public.user_reviews_before_write();

CREATE OR REPLACE FUNCTION public.user_reviews_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify(NEW.reviewee_id, 'review', COALESCE((SELECT full_name FROM profiles WHERE id = NEW.reviewer_id), 'Someone')
    || ' left you a ' || NEW.rating || '★ review', left(NEW.body, 140), '/u/' || (SELECT username FROM profiles WHERE id = NEW.reviewee_id));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS user_reviews_after_insert ON public.user_reviews;
CREATE TRIGGER user_reviews_after_insert AFTER INSERT ON public.user_reviews
  FOR EACH ROW EXECUTE FUNCTION public.user_reviews_after_insert();

-- ───────────────────────── 2. Business reviews: same 3-per-person rule, no self-reviews
CREATE OR REPLACE FUNCTION public.reviews_before_insert_limits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_client_request() THEN
    NEW.user_id := auth.uid();
    IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'Please sign in to leave a review'; END IF;
  END IF;
  IF NEW.rating IS NOT NULL AND NEW.rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Rating must be 1 to 5 stars'; END IF;
  IF NEW.company_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND claimed_by = NEW.user_id) THEN
      RAISE EXCEPTION 'You cannot review your own business';
    END IF;
    IF (SELECT count(*) FROM reviews WHERE user_id = NEW.user_id AND company_id = NEW.company_id) >= 3 THEN
      RAISE EXCEPTION 'You can leave at most 3 reviews for the same business';
    END IF;
  ELSIF NEW.professional_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    IF (SELECT count(*) FROM reviews WHERE user_id = NEW.user_id AND professional_id = NEW.professional_id) >= 3 THEN
      RAISE EXCEPTION 'You can leave at most 3 reviews for the same person';
    END IF;
  END IF;
  IF NEW.user_id IS NOT NULL AND (SELECT count(*) FROM reviews WHERE user_id = NEW.user_id AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Daily review limit reached — please try again tomorrow';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reviews_before_insert_limits ON public.reviews;
CREATE TRIGGER reviews_before_insert_limits BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_before_insert_limits();

-- Close the old loophole that let anyone post anonymous reviews of professionals
DROP POLICY IF EXISTS "Authenticated users can post reviews" ON public.reviews;
CREATE POLICY "Authenticated users can post reviews" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (company_id IS NOT NULL OR professional_id IS NOT NULL));
DROP POLICY IF EXISTS "Authenticated insert reviews" ON public.reviews;

-- ───────────────────────── 3. One combined rating per member
CREATE OR REPLACE FUNCTION public.member_rating(p_user uuid)
RETURNS TABLE (rating numeric, ratings_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(avg(r)::numeric, 1), count(r) FROM (
    SELECT client_rating AS r FROM contracts WHERE freelancer_id = p_user AND client_rating IS NOT NULL
    UNION ALL SELECT buyer_rating FROM orders WHERE seller_id = p_user AND buyer_rating IS NOT NULL
    UNION ALL SELECT rating FROM user_reviews WHERE reviewee_id = p_user AND NOT hidden
  ) x;
$$;

CREATE OR REPLACE FUNCTION public.get_public_profile(p_handle text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p profiles%ROWTYPE; me uuid := auth.uid(); r record;
BEGIN
  SELECT * INTO p FROM profiles WHERE username = lower(p_handle) OR id::text = p_handle LIMIT 1;
  IF NOT FOUND OR p.account_status IN ('blocked', 'rejected') OR (NOT p.is_public AND p.id IS DISTINCT FROM me) THEN RETURN NULL; END IF;
  SELECT * INTO r FROM member_rating(p.id);
  RETURN jsonb_build_object(
    'id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'cover_url', p.cover_url,
    'headline', p.headline, 'bio', p.bio, 'profession', p.profession, 'location', p.location, 'website', p.website,
    'skills', p.skills, 'user_type', p.user_type, 'member_since', p.created_at,
    'kyc_verified', p.kyc_status = 'approved', 'address_verified', p.address_status = 'approved',
    'followers', p.followers_count, 'following', p.following_count, 'posts', p.posts_count,
    'is_me', p.id = me,
    'is_following', EXISTS (SELECT 1 FROM follows WHERE follower_id = me AND following_id = p.id),
    'rating', r.rating, 'ratings_count', r.ratings_count,
    'my_review_count', (SELECT count(*) FROM user_reviews WHERE reviewer_id = me AND reviewee_id = p.id),
    'jobs_completed', (SELECT count(*) FROM contracts WHERE freelancer_id = p.id AND status = 'completed')
                    + (SELECT count(*) FROM orders WHERE seller_id = p.id AND status = 'completed'),
    'reviews', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (
        SELECT jsonb_build_object('id', ur.id, 'rating', ur.rating, 'title', ur.title, 'text', ur.body, 'at', ur.created_at,
                                  'relationship', ur.relationship, 'verified', ur.verified, 'source', 'review',
                                  'reviewer_id', ur.reviewer_id, 'reviewer_name', a.full_name, 'reviewer_username', a.username, 'reviewer_avatar', a.avatar_url) x
        FROM user_reviews ur JOIN profiles a ON a.id = ur.reviewer_id
        WHERE ur.reviewee_id = p.id AND NOT ur.hidden
        UNION ALL
        SELECT jsonb_build_object('rating', c.client_rating, 'text', c.client_review, 'title', c.title, 'at', c.completed_at,
                                  'verified', true, 'source', 'contract', 'reviewer_name', a.full_name, 'reviewer_username', a.username, 'reviewer_avatar', a.avatar_url)
        FROM contracts c JOIN profiles a ON a.id = c.client_id WHERE c.freelancer_id = p.id AND c.client_rating IS NOT NULL
        UNION ALL
        SELECT jsonb_build_object('rating', o.buyer_rating, 'text', o.buyer_review, 'title', o.title, 'at', o.completed_at,
                                  'verified', true, 'source', 'order', 'reviewer_name', a.full_name, 'reviewer_username', a.username, 'reviewer_avatar', a.avatar_url)
        FROM orders o JOIN profiles a ON a.id = o.buyer_id WHERE o.seller_id = p.id AND o.buyer_rating IS NOT NULL
        LIMIT 60) q), '[]'::jsonb)
  );
END $$;

-- Ratings alongside names everywhere members are listed
DROP FUNCTION IF EXISTS public.public_people(uuid[]);
CREATE FUNCTION public.public_people(p_ids uuid[])
RETURNS TABLE (id uuid, full_name text, username text, avatar_url text, headline text, profession text, verified boolean,
               user_type text, rating numeric, ratings_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.username, p.avatar_url, p.headline, p.profession, p.kyc_status = 'approved', p.user_type, r.rating, r.ratings_count
  FROM profiles p CROSS JOIN LATERAL member_rating(p.id) r
  WHERE p.id = ANY (p_ids[1:200]) AND p.account_status NOT IN ('blocked', 'rejected');
$$;

-- ───────────────────────── 4. Site-wide search: people, businesses, jobs
CREATE OR REPLACE FUNCTION public.search_directory(p_q text, p_limit integer DEFAULT 6, p_types text[] DEFAULT ARRAY['people', 'businesses', 'jobs'])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q text := btrim(COALESCE(p_q, '')); pat text; lim int := least(greatest(COALESCE(p_limit, 6), 1), 30);
BEGIN
  IF length(q) < 2 THEN RETURN jsonb_build_object('people', '[]'::jsonb, 'businesses', '[]'::jsonb, 'jobs', '[]'::jsonb); END IF;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN jsonb_build_object(
    'people', CASE WHEN 'people' = ANY (p_types) THEN COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT p.id, p.full_name, p.username, p.avatar_url, p.headline, p.profession, p.location, p.user_type,
               p.kyc_status = 'approved' AS verified, p.followers_count AS followers, r.rating, r.ratings_count
        FROM profiles p CROSS JOIN LATERAL member_rating(p.id) r
        WHERE p.is_public AND p.account_status NOT IN ('blocked', 'rejected', 'suspended') AND p.role IS DISTINCT FROM 'admin'
          AND (p.full_name ILIKE pat OR p.username ILIKE pat OR p.headline ILIKE pat OR p.profession ILIKE pat OR p.location ILIKE pat
               OR EXISTS (SELECT 1 FROM unnest(p.skills) s WHERE s ILIKE pat))
        ORDER BY (p.full_name ILIKE q || '%') DESC, (p.kyc_status = 'approved') DESC, r.ratings_count DESC, p.followers_count DESC
        LIMIT lim) x), '[]'::jsonb) ELSE '[]'::jsonb END,
    'businesses', CASE WHEN 'businesses' = ANY (p_types) THEN COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT c.id, c.name, c.category, c.city, c.country, c.logo_url, c.verified, c.rating, c.review_count
        FROM companies c
        WHERE c.is_active IS NOT FALSE AND (c.name ILIKE pat OR c.category ILIKE pat OR c.industry ILIKE pat OR c.city ILIKE pat)
        ORDER BY (c.name ILIKE q || '%') DESC, c.verified DESC NULLS LAST, c.review_count DESC NULLS LAST, c.name
        LIMIT lim) x), '[]'::jsonb) ELSE '[]'::jsonb END,
    'jobs', CASE WHEN 'jobs' = ANY (p_types) THEN COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT j.id, j.title, j.company, j.location, j.work_mode, j.posted_at
        FROM jobs j WHERE j.is_active AND (j.title ILIKE pat OR j.company ILIKE pat)
        ORDER BY (j.title ILIKE q || '%') DESC, j.posted_at DESC NULLS LAST
        LIMIT lim) x), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS profiles_name_trgm ON public.profiles USING gin (full_name gin_trgm_ops);
EXCEPTION WHEN undefined_object THEN NULL;   -- pg_trgm not installed: search still works, just without the index
END $$;

REVOKE EXECUTE ON FUNCTION public.user_reviews_before_write(), public.user_reviews_after_insert(), public.reviews_before_insert_limits()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_rating(uuid), public.get_public_profile(text), public.public_people(uuid[]),
  public.search_directory(text, integer, text[]) TO anon, authenticated;
