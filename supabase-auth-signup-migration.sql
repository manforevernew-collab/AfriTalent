-- New-user + social sign-in profile import (applied 2026-11-17).
-- First sign-in with Google / LinkedIn / Indeed (or email sign-up) creates the account and
-- its profile. Basic information the provider shares is imported:
--   name  ← full_name | name | given_name + family_name     (Google, LinkedIn; Indeed shares email only)
--   photo ← avatar_url | picture                            (https only)
--   type  ← user_type chosen on the sign-up page (job_seeker | business; anything else → job_seeker)
-- When an existing user later links another provider, blank name/photo are filled in.

CREATE OR REPLACE FUNCTION public.oauth_profile_name(meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(left(btrim(COALESCE(
    NULLIF(btrim(meta->>'full_name'), ''),
    NULLIF(btrim(meta->>'name'), ''),
    NULLIF(btrim(concat_ws(' ', meta->>'given_name', meta->>'family_name')), '')
  , '')), 120), '')
$$;

CREATE OR REPLACE FUNCTION public.oauth_profile_photo(meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p ~ '^https://' AND length(p) < 2048 THEN p END
  FROM (SELECT COALESCE(meta->>'avatar_url', meta->>'picture') AS p) s
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta  jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  utype text  := meta->>'user_type';
BEGIN
  IF utype IS NULL OR utype NOT IN ('job_seeker', 'business') THEN
    utype := 'job_seeker';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, user_type, kyc_status, address_status, avatar_url, setup_complete)
  VALUES (NEW.id, public.oauth_profile_name(meta), 'user', utype, 'unverified', 'unverified', public.oauth_profile_photo(meta), false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Linking a new provider updates raw_user_meta_data: fill in anything the profile is missing
CREATE OR REPLACE FUNCTION public.handle_user_meta_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  UPDATE public.profiles p
     SET full_name  = COALESCE(NULLIF(btrim(p.full_name), ''), public.oauth_profile_name(meta)),
         avatar_url = COALESCE(NULLIF(btrim(p.avatar_url), ''), public.oauth_profile_photo(meta))
   WHERE p.id = NEW.id
     AND ((NULLIF(btrim(p.full_name), '') IS NULL AND public.oauth_profile_name(meta) IS NOT NULL)
       OR (NULLIF(btrim(p.avatar_url), '') IS NULL AND public.oauth_profile_photo(meta) IS NOT NULL));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_meta_updated ON auth.users;
CREATE TRIGGER on_auth_user_meta_updated
  AFTER UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  WHEN (OLD.raw_user_meta_data IS DISTINCT FROM NEW.raw_user_meta_data)
  EXECUTE FUNCTION public.handle_user_meta_update();

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_meta_update() FROM PUBLIC, anon, authenticated;
