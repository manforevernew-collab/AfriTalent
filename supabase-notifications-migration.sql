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
