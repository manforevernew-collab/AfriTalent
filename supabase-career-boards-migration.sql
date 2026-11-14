-- AfriTalent: admin-managed employer career boards (Greenhouse, Lever, Ashby,
-- Workable, SmartRecruiters, Recruitee). The hourly job import reads this table
-- in addition to the built-in list. Safe to re-run.

CREATE TABLE IF NOT EXISTS career_boards (
  id              bigserial PRIMARY KEY,
  provider        text NOT NULL CHECK (provider IN ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee')),
  slug            text NOT NULL CHECK (slug ~ '^[A-Za-z0-9._-]{1,80}$'),
  company_name    text NOT NULL,
  website         text CHECK (website IS NULL OR website ~ '^https?://'),
  category        text,
  country         text,
  scope           text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'remote_or_africa')),
  enabled         boolean NOT NULL DEFAULT true,
  last_status     text,
  last_total      int,
  last_kept       int,
  last_error      text,
  last_checked_at timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (provider, slug)
);

ALTER TABLE career_boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Career boards admin read" ON career_boards;
CREATE POLICY "Career boards admin read" ON career_boards FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Career boards admin write" ON career_boards;
CREATE POLICY "Career boards admin write" ON career_boards FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

SELECT 'career_boards ready' AS status;
