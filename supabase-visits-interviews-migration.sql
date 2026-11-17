-- AfriTalent: profile visits, interviews, richer dashboard summary (2026-11-17). Safe to re-run.
-- Requires the notifications, social/marketplace and reviews/search migrations.

-- ───────────────────────── 1. Profile visits (unique visitor per day, owner excluded)
CREATE TABLE IF NOT EXISTS public.profile_views (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,                 -- user id, or a hash for signed-out visitors
  viewer_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  viewed_on  date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, viewer_key, viewed_on)
);
CREATE INDEX IF NOT EXISTS profile_views_recent ON public.profile_views (profile_id, viewed_on DESC);
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_views FROM anon, authenticated;   -- read through dashboard_summary only

CREATE OR REPLACE FUNCTION public.record_profile_view(p_profile uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); k text; hdr jsonb;
BEGIN
  IF p_profile IS NULL OR p_profile = me THEN RETURN; END IF;
  IF me IS NOT NULL THEN
    k := me::text;
  ELSE
    hdr := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
    k := 'anon:' || md5(COALESCE(split_part(hdr->>'x-forwarded-for', ',', 1), '') || '|' || COALESCE(hdr->>'user-agent', '') || '|' || current_date::text);
  END IF;
  INSERT INTO profile_views (profile_id, viewer_key, viewer_id) VALUES (p_profile, k, me)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN foreign_key_violation THEN NULL;
END $$;

-- ───────────────────────── 2. Interviews
CREATE TABLE IF NOT EXISTS public.interviews (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employer_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  candidate_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 140),
  job_id           integer,
  gig_id           bigint,
  scheduled_at     timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 10 AND 480),
  mode             text NOT NULL DEFAULT 'video' CHECK (mode IN ('video', 'phone', 'in_person')),
  location         text CHECK (location IS NULL OR length(location) <= 300),   -- meeting link, phone number or address
  notes            text CHECK (notes IS NULL OR length(notes) <= 2000),
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'accepted', 'declined', 'cancelled', 'completed')),
  response_note    text CHECK (response_note IS NULL OR length(response_note) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (employer_id <> candidate_id)
);
CREATE INDEX IF NOT EXISTS interviews_candidate ON public.interviews (candidate_id, scheduled_at);
CREATE INDEX IF NOT EXISTS interviews_employer ON public.interviews (employer_id, scheduled_at);
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.interviews TO authenticated;
DROP POLICY IF EXISTS "Interview parties read" ON public.interviews;
CREATE POLICY "Interview parties read" ON public.interviews FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (employer_id, candidate_id) OR public.is_admin());
DROP POLICY IF EXISTS "Schedule as yourself" ON public.interviews;
CREATE POLICY "Schedule as yourself" ON public.interviews FOR INSERT TO authenticated
  WITH CHECK (employer_id = (SELECT auth.uid()) AND public.is_active_user());
DROP POLICY IF EXISTS "Interview parties update" ON public.interviews;
CREATE POLICY "Interview parties update" ON public.interviews FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IN (employer_id, candidate_id)) WITH CHECK ((SELECT auth.uid()) IN (employer_id, candidate_id));

CREATE OR REPLACE FUNCTION public.interviews_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.is_client_request() THEN NEW.employer_id := me; END IF;
    IF NEW.scheduled_at < now() THEN RAISE EXCEPTION 'Pick a time in the future'; END IF;
    IF (SELECT count(*) FROM interviews WHERE employer_id = NEW.employer_id AND created_at > now() - interval '1 day') >= 30 THEN
      RAISE EXCEPTION 'Daily interview limit reached';
    END IF;
    NEW.status := 'scheduled'; NEW.response_note := NULL; NEW.created_at := now();
  ELSIF public.is_client_request() AND NOT public.is_admin() THEN
    NEW.employer_id := OLD.employer_id; NEW.candidate_id := OLD.candidate_id; NEW.created_at := OLD.created_at;
    IF me = OLD.candidate_id THEN
      -- candidates can only accept / decline (with a note)
      NEW.title := OLD.title; NEW.scheduled_at := OLD.scheduled_at; NEW.duration_minutes := OLD.duration_minutes;
      NEW.mode := OLD.mode; NEW.location := OLD.location; NEW.notes := OLD.notes; NEW.job_id := OLD.job_id; NEW.gig_id := OLD.gig_id;
      IF NEW.status NOT IN ('accepted', 'declined') OR OLD.status IN ('cancelled', 'completed') THEN NEW.status := OLD.status; END IF;
    ELSE
      -- employers can reschedule, cancel or complete; rescheduling asks the candidate again
      NEW.response_note := OLD.response_note;
      IF NEW.status NOT IN ('cancelled', 'completed') THEN
        NEW.status := CASE WHEN NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN 'scheduled' ELSE OLD.status END;
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS interviews_before_write ON public.interviews;
CREATE TRIGGER interviews_before_write BEFORE INSERT OR UPDATE ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.interviews_before_write();

CREATE OR REPLACE FUNCTION public.interviews_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp text; cand text; whenx text := to_char(NEW.scheduled_at AT TIME ZONE 'Africa/Lagos', 'Dy DD Mon, HH24:MI') || ' (WAT)';
BEGIN
  SELECT full_name INTO emp FROM profiles WHERE id = NEW.employer_id;
  SELECT full_name INTO cand FROM profiles WHERE id = NEW.candidate_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM notify(NEW.candidate_id, 'interview', COALESCE(emp, 'An employer') || ' invited you to an interview 📅',
      NEW.title || ' · ' || whenx || '. Accept or decline from your dashboard.', '/dashboard');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('accepted', 'declined') THEN
      PERFORM notify(NEW.employer_id, 'interview', COALESCE(cand, 'The candidate') || ' ' || NEW.status || ' your interview',
        NEW.title || ' · ' || whenx || COALESCE('. Note: ' || NEW.response_note, ''), '/dashboard');
    ELSIF NEW.status = 'cancelled' THEN
      PERFORM notify(CASE WHEN auth.uid() = NEW.candidate_id THEN NEW.employer_id ELSE NEW.candidate_id END, 'interview',
        'Interview cancelled: ' || NEW.title, whenx, '/dashboard');
    ELSIF NEW.status = 'scheduled' THEN
      PERFORM notify(NEW.candidate_id, 'interview', 'Interview rescheduled: ' || NEW.title, 'New time: ' || whenx, '/dashboard');
    END IF;
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.location IS DISTINCT FROM OLD.location THEN
    PERFORM notify(NEW.candidate_id, 'interview', 'Interview updated: ' || NEW.title, whenx, '/dashboard');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS interviews_after_write ON public.interviews;
CREATE TRIGGER interviews_after_write AFTER INSERT OR UPDATE ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.interviews_after_write();

-- ───────────────────────── 3. Dashboard overview
CREATE OR REPLACE FUNCTION public.dashboard_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); r record;
BEGIN
  IF me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM member_rating(me);
  RETURN jsonb_build_object(
    'profile_views_30d', (SELECT count(*) FROM profile_views WHERE profile_id = me AND viewed_on > current_date - 30),
    'profile_views_prev_30d', (SELECT count(*) FROM profile_views WHERE profile_id = me AND viewed_on <= current_date - 30 AND viewed_on > current_date - 60),
    'profile_views_total', (SELECT count(*) FROM profile_views WHERE profile_id = me),
    'jobs_done', (SELECT count(*) FROM contracts WHERE freelancer_id = me AND status = 'completed')
               + (SELECT count(*) FROM orders WHERE seller_id = me AND status = 'completed'),
    'jobs_in_progress', (SELECT count(*) FROM contracts WHERE freelancer_id = me AND status IN ('funded', 'submitted', 'revision_requested'))
                      + (SELECT count(*) FROM orders WHERE seller_id = me AND status IN ('paid', 'shipped')),
    'job_applications', (SELECT count(*) FROM applications WHERE user_id = me),
    'proposals_sent', (SELECT count(*) FROM gig_proposals WHERE freelancer_id = me),
    'proposals_accepted', (SELECT count(*) FROM gig_proposals WHERE freelancer_id = me AND status = 'accepted'),
    'interviews_upcoming', (SELECT count(*) FROM interviews WHERE me IN (candidate_id, employer_id) AND status IN ('scheduled', 'accepted') AND scheduled_at > now() - interval '1 hour'),
    'earned_total', COALESCE((SELECT sum(amount) FROM wallet_transactions WHERE user_id = me AND type = 'earning'), 0),
    'earned_30d', COALESCE((SELECT sum(amount) FROM wallet_transactions WHERE user_id = me AND type = 'earning' AND created_at > now() - interval '30 days'), 0),
    'pending_earnings', COALESCE((SELECT sum(amount) FROM contracts WHERE freelancer_id = me AND status IN ('funded', 'submitted', 'revision_requested')), 0)
                      + COALESCE((SELECT sum(amount) FROM orders WHERE seller_id = me AND status IN ('paid', 'shipped')), 0),
    'currency', COALESCE((SELECT currency FROM wallets WHERE user_id = me), (SELECT currency FROM app_settings WHERE id = 1), 'NGN'),
    'rating', r.rating, 'ratings_count', r.ratings_count,
    'interviews', COALESCE((SELECT jsonb_agg(x ORDER BY x.scheduled_at) FROM (
        SELECT i.id, i.title, i.scheduled_at, i.duration_minutes, i.mode, i.location, i.notes, i.status,
               (i.candidate_id = me) AS as_candidate,
               o.full_name AS other_name, o.username AS other_username, o.avatar_url AS other_avatar
        FROM interviews i JOIN profiles o ON o.id = CASE WHEN i.candidate_id = me THEN i.employer_id ELSE i.candidate_id END
        WHERE me IN (i.candidate_id, i.employer_id) AND i.status IN ('scheduled', 'accepted') AND i.scheduled_at > now() - interval '1 hour'
        ORDER BY i.scheduled_at LIMIT 10) x), '[]'::jsonb),
    'recent_applications', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT a.created_at, j.id AS job_id, j.title, j.company, 'job' AS kind, NULL::text AS status FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = me
        UNION ALL
        SELECT gp.created_at, g.id, g.title, NULL, 'gig', gp.status FROM gig_proposals gp JOIN gigs g ON g.id = gp.gig_id WHERE gp.freelancer_id = me
        ORDER BY 1 DESC LIMIT 6) x), '[]'::jsonb),
    'recent_earnings', COALESCE((SELECT jsonb_agg(t ORDER BY t.created_at DESC) FROM (
        SELECT id, amount, description, created_at FROM wallet_transactions WHERE user_id = me AND type = 'earning' ORDER BY created_at DESC LIMIT 6) t), '[]'::jsonb),
    'recent_jobs_done', COALESCE((SELECT jsonb_agg(x ORDER BY x.done_at DESC) FROM (
        SELECT c.id, c.title, c.amount, c.completed_at AS done_at, c.client_rating AS rating, 'contract' AS kind FROM contracts c WHERE c.freelancer_id = me AND c.status = 'completed'
        UNION ALL
        SELECT o.id, o.title, o.amount, o.completed_at, o.buyer_rating, 'order' FROM orders o WHERE o.seller_id = me AND o.status = 'completed'
        ORDER BY 4 DESC LIMIT 6) x), '[]'::jsonb)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.interviews_before_write(), public.interviews_after_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_profile_view(uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary() TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.interviews;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
