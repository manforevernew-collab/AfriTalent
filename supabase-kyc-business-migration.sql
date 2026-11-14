-- AfriTalent: KYC screening, secure storage, business directory & claims
-- Run AFTER supabase-companies-reviews-migration.sql. Safe to re-run.

-- =============================================================================
-- 0. Helpers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- True for browser users (anon / authenticated). False for the service-role key
-- (server jobs) and the SQL editor.
CREATE OR REPLACE FUNCTION public.is_client_request()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.role(), '') IN ('anon', 'authenticated');
$$;

-- =============================================================================
-- 1. Profiles: users must not be able to approve themselves or become admin
-- =============================================================================
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_client_request() AND NOT public.is_admin() THEN
    NEW.role := OLD.role;
    NEW.kyc_status := OLD.kyc_status;
    NEW.address_status := OLD.address_status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_profile_columns ON profiles;
CREATE TRIGGER protect_profile_columns BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

DROP POLICY IF EXISTS "Admins update any profile" ON profiles;
CREATE POLICY "Admins update any profile" ON profiles FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =============================================================================
-- 2. Storage: private KYC bucket, owner-only folders, admin read
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('kyc', 'kyc', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('resumes', 'resumes', true, 10485760) ON CONFLICT (id) DO NOTHING;

-- Old policies let ANY signed-in user read every KYC file — remove them.
DROP POLICY IF EXISTS "Authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users read own files" ON storage.objects;

-- kyc/<uid>/..., address/<uid>/..., claims/<uid>/... — owner only
DROP POLICY IF EXISTS "KYC owner upload" ON storage.objects;
CREATE POLICY "KYC owner upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc'
    AND (storage.foldername(name))[1] IN ('kyc', 'address', 'claims')
    AND (storage.foldername(name))[2] = auth.uid()::text);
DROP POLICY IF EXISTS "KYC owner read" ON storage.objects;
CREATE POLICY "KYC owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc' AND (storage.foldername(name))[2] = auth.uid()::text);
DROP POLICY IF EXISTS "KYC admin read" ON storage.objects;
CREATE POLICY "KYC admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc' AND public.is_admin());
DROP POLICY IF EXISTS "KYC admin specimens" ON storage.objects;
CREATE POLICY "KYC admin specimens" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kyc' AND (storage.foldername(name))[1] = 'specimens' AND public.is_admin());

DROP POLICY IF EXISTS "Resume uploads" ON storage.objects;
CREATE POLICY "Resume uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes');
DROP POLICY IF EXISTS "Resume reads" ON storage.objects;
CREATE POLICY "Resume reads" ON storage.objects FOR SELECT USING (bucket_id = 'resumes');

-- =============================================================================
-- 3. KYC automated screening
-- =============================================================================
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS country          text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS id_type          text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS id_last4         text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS id_number_hash   text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS full_name_on_id  text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS date_of_birth    date;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS expiry_date      date;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS doc_sha256       text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS doc_dhash        text;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS auto_status      text DEFAULT 'pending'; -- pending|passed|review|rejected
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS risk_score       integer;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS auto_flags       jsonb DEFAULT '[]'::jsonb;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS auto_checked_at  timestamptz;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS screen_attempts  integer DEFAULT 0;
ALTER TABLE kyc_verifications ADD COLUMN IF NOT EXISTS reviewer_note    text;

CREATE INDEX IF NOT EXISTS kyc_id_number_hash_idx ON kyc_verifications (id_number_hash);
CREATE INDEX IF NOT EXISTS kyc_doc_sha_idx ON kyc_verifications (doc_sha256);
CREATE INDEX IF NOT EXISTS kyc_queue_idx ON kyc_verifications (status, auto_status);

-- Browser users can submit/resubmit, but only the server screening (service role)
-- or an admin can set the verdict fields.
CREATE OR REPLACE FUNCTION public.protect_kyc_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_client_request() AND NOT public.is_admin() THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
      RAISE EXCEPTION 'Approved verifications cannot be changed';
    END IF;
    NEW.status := 'pending';
    NEW.verified_at := NULL;
    NEW.auto_status := 'pending';
    NEW.risk_score := NULL;
    NEW.auto_flags := '[]'::jsonb;
    NEW.auto_checked_at := NULL;
    NEW.reviewer_note := NULL;
    IF TG_OP = 'INSERT' THEN
      NEW.user_id := auth.uid();
      NEW.screen_attempts := 0;
      NEW.id_number_hash := NULL; NEW.id_last4 := NULL; NEW.doc_sha256 := NULL; NEW.doc_dhash := NULL;
    ELSE
      NEW.user_id := OLD.user_id;
      NEW.screen_attempts := OLD.screen_attempts;
      NEW.id_number_hash := OLD.id_number_hash; NEW.id_last4 := OLD.id_last4;
      NEW.doc_sha256 := OLD.doc_sha256; NEW.doc_dhash := OLD.doc_dhash;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_kyc_columns ON kyc_verifications;
CREATE TRIGGER protect_kyc_columns BEFORE INSERT OR UPDATE ON kyc_verifications
  FOR EACH ROW EXECUTE FUNCTION public.protect_kyc_columns();

ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "KYC own select" ON kyc_verifications;
CREATE POLICY "KYC own select" ON kyc_verifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "KYC own insert" ON kyc_verifications;
CREATE POLICY "KYC own insert" ON kyc_verifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "KYC own update" ON kyc_verifications;
CREATE POLICY "KYC own update" ON kyc_verifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()) WITH CHECK (user_id = auth.uid() OR public.is_admin());

ALTER TABLE address_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Address own select" ON address_verifications;
CREATE POLICY "Address own select" ON address_verifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Address own insert" ON address_verifications;
CREATE POLICY "Address own insert" ON address_verifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Address own update" ON address_verifications;
CREATE POLICY "Address own update" ON address_verifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()) WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.protect_address_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_client_request() AND NOT public.is_admin() THEN
    NEW.status := 'pending';
    NEW.verified_at := NULL;
    NEW.user_id := CASE WHEN TG_OP = 'INSERT' THEN auth.uid() ELSE OLD.user_id END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_address_columns ON address_verifications;
CREATE TRIGGER protect_address_columns BEFORE INSERT OR UPDATE ON address_verifications
  FOR EACH ROW EXECUTE FUNCTION public.protect_address_columns();

-- Official specimen library (fingerprints only — images stay in kyc/specimens/)
CREATE TABLE IF NOT EXISTS kyc_specimens (
  id           bigserial PRIMARY KEY,
  label        text NOT NULL,
  country      text,
  doc_type     text,
  source_url   text,
  storage_path text,
  dhash        text NOT NULL,
  sha256       text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE kyc_specimens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Specimens admin read" ON kyc_specimens;
CREATE POLICY "Specimens admin read" ON kyc_specimens FOR SELECT TO authenticated USING (public.is_admin());
-- writes go through /api/kyc-specimen (service role)

-- =============================================================================
-- 4. Business directory
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE companies ALTER COLUMN rating DROP DEFAULT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS external_id   text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS source        text DEFAULT 'AfriTalent';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS source_url    text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS category      text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS services      text[] DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address       text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS city          text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country       text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS scan_city     text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lat           double precision;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lng           double precision;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone         text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website       text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS opening_hours text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS socials       jsonb DEFAULT '{}'::jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand         text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url      text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS claimed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS claimed_at    timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS verified      boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active     boolean DEFAULT true;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz DEFAULT now();
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_at    timestamptz DEFAULT now();
ALTER TABLE companies ADD COLUMN IF NOT EXISTS search_text   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_external_id_key') THEN
    ALTER TABLE companies ADD CONSTRAINT companies_external_id_key UNIQUE (external_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.companies_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_client_request() AND NOT public.is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      -- "Add your business": the creator owns it, unverified until the team checks it
      NEW.claimed_by := auth.uid();
      NEW.claimed_at := now();
      NEW.verified := false;
      NEW.source := 'Owner';
      NEW.external_id := NULL;
      NEW.source_url := NULL;
      NEW.rating := NULL;
      NEW.review_count := 0;
      NEW.is_active := true;
    ELSE
      NEW.claimed_by := OLD.claimed_by;
      NEW.claimed_at := OLD.claimed_at;
      NEW.verified := OLD.verified;
      NEW.source := OLD.source;
      NEW.external_id := OLD.external_id;
      NEW.source_url := OLD.source_url;
      NEW.rating := OLD.rating;
      NEW.review_count := OLD.review_count;
      NEW.is_active := OLD.is_active;
      NEW.scan_city := OLD.scan_city;
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.search_text := lower(concat_ws(' ', NEW.name, NEW.category, NEW.industry, NEW.city, NEW.country,
    array_to_string(NEW.services, ' '), NEW.brand));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS companies_before_write ON companies;
CREATE TRIGGER companies_before_write BEFORE INSERT OR UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_before_write();

UPDATE companies SET search_text = NULL WHERE search_text IS NULL; -- fires the trigger for existing rows

CREATE INDEX IF NOT EXISTS companies_search_trgm ON companies USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS companies_country_city_idx ON companies (country, city);
CREATE INDEX IF NOT EXISTS companies_category_idx ON companies (category);
CREATE INDEX IF NOT EXISTS companies_active_idx ON companies (is_active);
CREATE INDEX IF NOT EXISTS companies_scan_city_idx ON companies (scan_city, source);

DROP POLICY IF EXISTS "Owners add businesses" ON companies;
CREATE POLICY "Owners add businesses" ON companies FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Owners edit their business" ON companies;
CREATE POLICY "Owners edit their business" ON companies FOR UPDATE TO authenticated
  USING (claimed_by = auth.uid() OR public.is_admin())
  WITH CHECK (claimed_by = auth.uid() OR public.is_admin());

-- Claims ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_claims (
  id                 bigserial PRIMARY KEY,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  claimant_name      text,
  claimant_role      text,
  business_email     text,
  business_phone     text,
  message            text,
  evidence_path      text,
  email_domain_match boolean DEFAULT false,
  reviewer_note      text,
  reviewed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  created_at         timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_claims_one_pending
  ON company_claims (company_id, user_id) WHERE status = 'pending';

-- Server-side truth: does the claimant's *verified login email* share the
-- business website's domain? (free webmail never counts)
CREATE OR REPLACE FUNCTION public.company_claims_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  login_domain text := lower(split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 2));
  site text;
  site_domain text;
BEGIN
  IF public.is_client_request() THEN
    NEW.user_id := auth.uid();
    NEW.status := 'pending';
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.reviewer_note := NULL;
  END IF;
  SELECT website INTO site FROM companies WHERE id = NEW.company_id;
  site_domain := lower(regexp_replace(regexp_replace(COALESCE(site, ''), '^https?://(www\.)?', ''), '[/:?#].*$', ''));
  NEW.email_domain_match := login_domain <> '' AND site_domain <> ''
    AND login_domain NOT IN ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','live.com','aol.com','proton.me','protonmail.com','ymail.com','mail.com')
    AND (login_domain = site_domain OR site_domain LIKE '%.' || login_domain OR login_domain LIKE '%.' || site_domain);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_claims_before_insert ON company_claims;
CREATE TRIGGER company_claims_before_insert BEFORE INSERT ON company_claims
  FOR EACH ROW EXECUTE FUNCTION public.company_claims_before_insert();

-- Approving a claim hands the profile to the claimant (atomic, admin only).
CREATE OR REPLACE FUNCTION public.company_claims_after_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    UPDATE companies SET claimed_by = NEW.user_id, claimed_at = now(), verified = true WHERE id = NEW.company_id;
    UPDATE company_claims SET status = 'rejected', reviewer_note = 'Another claim was approved', reviewed_at = now()
      WHERE company_id = NEW.company_id AND id <> NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_claims_after_review ON company_claims;
CREATE TRIGGER company_claims_after_review AFTER UPDATE ON company_claims
  FOR EACH ROW EXECUTE FUNCTION public.company_claims_after_review();

ALTER TABLE company_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Claims own or admin read" ON company_claims;
CREATE POLICY "Claims own or admin read" ON company_claims FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Claims insert own" ON company_claims;
CREATE POLICY "Claims insert own" ON company_claims FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Claims admin review" ON company_claims;
CREATE POLICY "Claims admin review" ON company_claims FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Import log -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_sync_runs (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text,
  total_fetched integer DEFAULT 0,
  upserted      integer DEFAULT 0,
  deactivated   integer DEFAULT 0,
  cities        jsonb DEFAULT '{}'::jsonb,
  errors        jsonb DEFAULT '[]'::jsonb
);
ALTER TABLE business_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Business sync runs public" ON business_sync_runs;
CREATE POLICY "Business sync runs public" ON business_sync_runs FOR SELECT USING (true);

-- Verify: list the policies now in force
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND tablename IN ('profiles', 'kyc_verifications', 'address_verifications', 'companies', 'company_claims', 'objects')
ORDER BY tablename, policyname;
