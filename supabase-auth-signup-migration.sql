-- New-user trigger for email + Google/LinkedIn sign-up (applied 2026-11-17).
--  • Only accepts the account types the app supports (metadata is user-controlled)
--  • Picks up the name and photo Google/LinkedIn provide (full_name / name, avatar_url / picture)
--  • Pinned search_path (SECURITY DEFINER best practice) and idempotent insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta  jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  utype text  := meta->>'user_type';
  pic   text  := COALESCE(meta->>'avatar_url', meta->>'picture');
BEGIN
  IF utype IS NULL OR utype NOT IN ('job_seeker', 'business') THEN
    utype := 'job_seeker';
  END IF;
  IF pic IS NOT NULL AND pic !~ '^https://' THEN
    pic := NULL;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, user_type, kyc_status, address_status, avatar_url, setup_complete)
  VALUES (
    NEW.id,
    NULLIF(left(btrim(COALESCE(meta->>'full_name', meta->>'name', '')), 120), ''),
    'user',
    utype,
    'unverified',
    'unverified',
    pic,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
