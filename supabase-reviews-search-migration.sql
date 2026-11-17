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
