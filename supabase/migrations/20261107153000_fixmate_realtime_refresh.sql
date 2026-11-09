-- Enable authenticated, RLS-filtered Realtime for tables used by FixMate workspaces.
-- Client listeners subscribe only to INSERT/UPDATE events; DELETE payloads are deliberately omitted.
DO $fixmate_realtime_publication$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'The Supabase supabase_realtime publication does not exist';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'profiles',
    'customer_requests',
    'artisan_offers',
    'request_messages',
    'artisan_profiles',
    'artisan_service_zones',
    'pilot_service_zones',
    'customer_verification_submissions',
    'artisan_verification_applications',
    'artisan_verification_checks',
    'artisan_verification_documents',
    'user_complaints',
    'fixmate_request_events',
    'customer_request_attachments',
    'artisan_portfolio_items',
    'fixmate_contact_settings'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Required FixMate Realtime table public.% does not exist', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', 'supabase_realtime', v_table);
    END IF;
  END LOOP;
END;
$fixmate_realtime_publication$;

-- Public artisan reviews are read through safe summary RPCs. Touch the already-public
-- artisan profile so approved customers can refresh the aggregate without subscribing
-- to raw review rows, which contain reviewer identifiers.
CREATE OR REPLACE FUNCTION private.fixmate_bump_artisan_public_profile_on_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_artisan_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_artisan_id := OLD.artisan_id;
  ELSE
    v_artisan_id := NEW.artisan_id;
  END IF;

  UPDATE public.artisan_profiles
  SET updated_at = now()
  WHERE user_id = v_artisan_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.fixmate_bump_artisan_public_profile_on_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fixmate_bump_artisan_profile_after_review ON public.job_reviews;
CREATE TRIGGER fixmate_bump_artisan_profile_after_review
AFTER INSERT ON public.job_reviews
FOR EACH ROW
EXECUTE FUNCTION private.fixmate_bump_artisan_public_profile_on_activity();

DROP TRIGGER IF EXISTS fixmate_bump_artisan_profile_after_portfolio_delete ON public.artisan_portfolio_items;
CREATE TRIGGER fixmate_bump_artisan_profile_after_portfolio_delete
AFTER DELETE ON public.artisan_portfolio_items
FOR EACH ROW
EXECUTE FUNCTION private.fixmate_bump_artisan_public_profile_on_activity();
