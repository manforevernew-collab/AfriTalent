-- AfriTalent: Companies & company reviews
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- NOTE: the project already has a `reviews` table for *professional* reviews
-- (id integer, professional_id, author, rating, text, created_at). This migration
-- EXTENDS that table with company-review columns instead of trying to create a
-- second one, so existing professional reviews keep working.

-- 1. Companies ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text,
  location text,
  description text,
  rating numeric(2,1),            -- NULL until the first review (no invented scores)
  review_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Company-review columns on the existing reviews table ----------------------
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS company_id    uuid REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS title         text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS body          text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS author_name   text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS author_role   text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS helpful_count integer DEFAULT 0;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();

-- Company reviews have no professional
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'reviews'
               AND column_name = 'professional_id' AND is_nullable = 'NO') THEN
    ALTER TABLE reviews ALTER COLUMN professional_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reviews_company_idx ON reviews (company_id);

-- 3. Keep company rating / review_count in sync (company reviews only) ---------
CREATE OR REPLACE FUNCTION refresh_company_rating()
RETURNS trigger AS $$
DECLARE
  cid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF cid IS NOT NULL THEN
    UPDATE companies c
    SET rating = COALESCE((SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.company_id = c.id), NULL),
        review_count = (SELECT count(*) FROM reviews r WHERE r.company_id = c.id)
    WHERE c.id = cid;
  END IF;
  -- A review moved between companies: refresh the old one too
  IF TG_OP = 'UPDATE' AND OLD.company_id IS DISTINCT FROM NEW.company_id AND OLD.company_id IS NOT NULL THEN
    UPDATE companies c
    SET rating = COALESCE((SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.company_id = c.id), NULL),
        review_count = (SELECT count(*) FROM reviews r WHERE r.company_id = c.id)
    WHERE c.id = OLD.company_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS reviews_refresh_company ON reviews;
CREATE TRIGGER reviews_refresh_company
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION refresh_company_rating();

-- 4. "Helpful" vote used by the Reviews page (reviews.id is an integer) ---------
DROP FUNCTION IF EXISTS increment_helpful(uuid);
CREATE OR REPLACE FUNCTION increment_helpful(review_id bigint)
RETURNS void AS $$
  UPDATE reviews SET helpful_count = COALESCE(helpful_count, 0) + 1 WHERE id = review_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION increment_helpful(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_helpful(bigint) TO anon, authenticated;

-- 5. Row Level Security --------------------------------------------------------
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Companies are viewable by everyone" ON companies;
CREATE POLICY "Companies are viewable by everyone" ON companies FOR SELECT USING (true);

DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON reviews;
CREATE POLICY "Reviews are viewable by everyone" ON reviews FOR SELECT USING (true);

-- Company reviews must be signed by the author; professional reviews (the
-- existing feature) stay open to any signed-in user as before.
DROP POLICY IF EXISTS "Authenticated users can post reviews" ON reviews;
CREATE POLICY "Authenticated users can post reviews" ON reviews FOR INSERT TO authenticated
  WITH CHECK (
    (company_id IS NOT NULL AND auth.uid() = user_id)
    OR (company_id IS NULL AND professional_id IS NOT NULL)
  );

DROP POLICY IF EXISTS "Users can update their own reviews" ON reviews;
CREATE POLICY "Users can update their own reviews" ON reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
