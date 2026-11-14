-- AfriTalent: Job aggregator migration
-- Adds the columns used by the hourly job importer + filters, and a sync log table.
-- Safe to re-run. Run in the Supabase SQL Editor.

-- 1. New columns on jobs ----------------------------------------------------
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id      text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source           text DEFAULT 'AfriTalent';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_url       text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_url        text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_logo     text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_mode        text DEFAULT 'On-site';   -- Remote | Hybrid | On-site
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visa_sponsorship boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS relocation       boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_level text DEFAULT 'Mid';       -- Internship | Entry | Mid | Senior | Executive
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_external      boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_active        boolean DEFAULT true;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_at     timestamptz DEFAULT now();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at        timestamptz DEFAULT now();

-- Imported jobs have no AfriTalent poster
ALTER TABLE jobs ALTER COLUMN posted_by DROP NOT NULL;

-- Upsert key for imported jobs (NULLs allowed for jobs posted on AfriTalent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_external_id_key') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_external_id_key UNIQUE (external_id);
  END IF;
END $$;

-- Backfill existing (AfriTalent-posted) rows
UPDATE jobs SET is_active = true WHERE is_active IS NULL;
UPDATE jobs SET is_external = false WHERE is_external IS NULL;
UPDATE jobs SET source = 'AfriTalent' WHERE source IS NULL;
UPDATE jobs SET work_mode = CASE
    WHEN location ILIKE '%hybrid%' THEN 'Hybrid'
    WHEN location ILIKE '%remote%' THEN 'Remote'
    ELSE 'On-site' END
  WHERE work_mode IS NULL OR (is_external = false AND posted_by IS NULL AND work_mode = 'On-site');

-- 2. Indexes for the filter UI ----------------------------------------------
CREATE INDEX IF NOT EXISTS jobs_active_posted_idx ON jobs (is_active, posted_at DESC);
CREATE INDEX IF NOT EXISTS jobs_work_mode_idx     ON jobs (work_mode);
CREATE INDEX IF NOT EXISTS jobs_visa_idx          ON jobs (visa_sponsorship) WHERE visa_sponsorship;
CREATE INDEX IF NOT EXISTS jobs_source_idx        ON jobs (source);
CREATE INDEX IF NOT EXISTS jobs_level_idx         ON jobs (experience_level);
CREATE INDEX IF NOT EXISTS jobs_category_idx      ON jobs (category);

-- 3. Sync run log ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_sync_runs (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text,            -- success | partial | error
  total_fetched integer DEFAULT 0,
  upserted      integer DEFAULT 0,
  deactivated   integer DEFAULT 0,
  sources       jsonb DEFAULT '{}'::jsonb,
  errors        jsonb DEFAULT '[]'::jsonb
);

ALTER TABLE job_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sync runs are viewable by everyone" ON job_sync_runs;
CREATE POLICY "Sync runs are viewable by everyone" ON job_sync_runs FOR SELECT USING (true);
-- Inserts come from the server using the service-role key (bypasses RLS).

-- Jobs: public read; only the importer (service-role key, bypasses RLS) can create
-- "external" jobs. Signed-in users may only post/edit their own AfriTalent jobs,
-- so nobody can plant a fake "imported" listing with a phishing apply link.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Jobs are viewable by everyone" ON jobs;
CREATE POLICY "Jobs are viewable by everyone" ON jobs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated insert jobs" ON jobs;
CREATE POLICY "Authenticated insert jobs" ON jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = posted_by AND COALESCE(is_external, false) = false AND external_id IS NULL);

DROP POLICY IF EXISTS "Users update own jobs" ON jobs;
CREATE POLICY "Users update own jobs" ON jobs FOR UPDATE TO authenticated
  USING (auth.uid() = posted_by)
  WITH CHECK (auth.uid() = posted_by AND COALESCE(is_external, false) = false AND external_id IS NULL);

DROP POLICY IF EXISTS "Users delete own jobs" ON jobs;
CREATE POLICY "Users delete own jobs" ON jobs FOR DELETE TO authenticated USING (auth.uid() = posted_by);

-- 4. OPTIONAL: schedule the hourly sync from inside Supabase ------------------
-- Use this if you deploy on Vercel Hobby (whose crons only run once per day) and
-- don't want to use the GitHub Actions workflow. Replace the URL and secret.
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
-- SELECT cron.schedule('afritalent-hourly-job-sync', '0 * * * *', $$
--   SELECT net.http_get(
--     url := 'https://YOUR-APP.vercel.app/api/sync-jobs',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
--     timeout_milliseconds := 290000
--   );
-- $$);

-- Verify
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'jobs' ORDER BY ordinal_position;
