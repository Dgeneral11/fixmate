
DO $$
BEGIN
  CREATE TYPE public.fixmate_account_status AS ENUM ('pending_approval', 'active', 'rejected', 'restricted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.fixmate_customer_review_status AS ENUM ('draft', 'submitted', 'in_review', 'needs_more_info', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'fixmate_service_category'
      AND e.enumlabel = 'computer_services'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'fixmate_service_category'
      AND e.enumlabel = 'phone_computer_repair'
  ) THEN
    EXECUTE 'ALTER TYPE public.fixmate_service_category RENAME VALUE ''computer_services'' TO ''phone_computer_repair''';
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS account_status public.fixmate_account_status NOT NULL DEFAULT 'pending_approval';

CREATE INDEX IF NOT EXISTS profiles_email_search_idx ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS profiles_account_status_idx ON public.profiles (account_status, role);
GRANT SELECT (email, account_status) ON TABLE public.profiles TO authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_whatsapp_format_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_whatsapp_format_check
      CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{10,15}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.fixmate_profile_is_active(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.account_status = 'active'::public.fixmate_account_status
  );
$function$;

REVOKE ALL ON FUNCTION private.fixmate_profile_is_active(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_profile_is_active(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_handle_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.fixmate_role := 'customer'::public.fixmate_role;
  v_status public.fixmate_account_status := 'pending_approval'::public.fixmate_account_status;
  v_is_allowlisted_admin boolean := false;
  v_display_name text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.fixmate_admin_allowlist a
    WHERE a.email = lower(coalesce(new.email, ''))
      AND a.enabled
      AND new.email_confirmed_at IS NOT NULL
  ) INTO v_is_allowlisted_admin;

  IF v_is_allowlisted_admin THEN
    v_role := 'administrator'::public.fixmate_role;
    v_status := 'active'::public.fixmate_account_status;
  ELSIF tg_op = 'INSERT'
    AND lower(coalesce(new.raw_user_meta_data ->> 'requested_role', '')) = 'artisan' THEN
    v_role := 'artisan'::public.fixmate_role;
  END IF;

  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    ''
  );

  INSERT INTO public.profiles (id, role, email, display_name, account_status)
  VALUES (new.id, v_role, lower(nullif(new.email, '')), v_display_name, v_status)
  ON CONFLICT (id) DO UPDATE
    SET email = lower(nullif(new.email, '')),
        display_name = CASE WHEN v_display_name <> '' THEN v_display_name ELSE public.profiles.display_name END,
        role = CASE
          WHEN v_is_allowlisted_admin THEN 'administrator'::public.fixmate_role
          WHEN public.profiles.role = 'administrator'::public.fixmate_role THEN 'customer'::public.fixmate_role
          ELSE public.profiles.role
        END,
        account_status = CASE
          WHEN v_is_allowlisted_admin THEN 'active'::public.fixmate_account_status
          WHEN public.profiles.role = 'administrator'::public.fixmate_role THEN 'pending_approval'::public.fixmate_account_status
          ELSE public.profiles.account_status
        END,
        updated_at = now();

  IF v_role = 'artisan'::public.fixmate_role THEN
    INSERT INTO public.artisan_profiles (user_id, display_name)
    VALUES (new.id, v_display_name)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.fixmate_contact_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  support_whatsapp_number text NOT NULL CHECK (support_whatsapp_number ~ '^[0-9+]{10,16}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fixmate_contact_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixmate_contact_settings_read_public ON public.fixmate_contact_settings;
DROP POLICY IF EXISTS fixmate_contact_settings_update_admin ON public.fixmate_contact_settings;
CREATE POLICY fixmate_contact_settings_read_public
  ON public.fixmate_contact_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY fixmate_contact_settings_update_admin
  ON public.fixmate_contact_settings FOR UPDATE TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role))
  WITH CHECK (public.fixmate_has_role('administrator'::public.fixmate_role));
GRANT SELECT ON TABLE public.fixmate_contact_settings TO anon, authenticated;
GRANT UPDATE (support_whatsapp_number) ON TABLE public.fixmate_contact_settings TO authenticated;
CREATE OR REPLACE FUNCTION public.fixmate_touch_contact_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS fixmate_contact_settings_touch_updated_at ON public.fixmate_contact_settings;
CREATE TRIGGER fixmate_contact_settings_touch_updated_at
  BEFORE UPDATE ON public.fixmate_contact_settings
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_touch_contact_settings();
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.fixmate_contact_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.pilot_service_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_group text NOT NULL CHECK (zone_group IN ('Student halls and hostels', 'Gates and access points', 'Markets and commercial centres', 'Student service centres and landmarks')),
  name text NOT NULL UNIQUE,
  sort_order smallint NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pilot_service_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pilot_service_zones_read_active ON public.pilot_service_zones;
DROP POLICY IF EXISTS pilot_service_zones_admin_manage ON public.pilot_service_zones;
CREATE POLICY pilot_service_zones_read_active
  ON public.pilot_service_zones FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY pilot_service_zones_admin_manage
  ON public.pilot_service_zones FOR ALL TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role))
  WITH CHECK (public.fixmate_has_role('administrator'::public.fixmate_role));
GRANT SELECT ON TABLE public.pilot_service_zones TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.pilot_service_zones TO authenticated;

CREATE TABLE IF NOT EXISTS public.artisan_service_zones (
  artisan_id uuid NOT NULL REFERENCES public.artisan_profiles(user_id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.pilot_service_zones(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artisan_id, zone_id)
);
ALTER TABLE public.artisan_service_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artisan_service_zones_read ON public.artisan_service_zones;
DROP POLICY IF EXISTS artisan_service_zones_insert_owner ON public.artisan_service_zones;
DROP POLICY IF EXISTS artisan_service_zones_delete_owner ON public.artisan_service_zones;
CREATE POLICY artisan_service_zones_read
  ON public.artisan_service_zones FOR SELECT TO authenticated
  USING (
    artisan_id = (SELECT auth.uid())
    OR public.fixmate_has_role('administrator'::public.fixmate_role)
    OR (private.fixmate_profile_is_active(artisan_id) AND public.fixmate_is_verified_artisan(artisan_id))
  );
CREATE POLICY artisan_service_zones_insert_owner
  ON public.artisan_service_zones FOR INSERT TO authenticated
  WITH CHECK (
    artisan_id = (SELECT auth.uid())
    AND public.fixmate_has_role('artisan'::public.fixmate_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.account_status IN ('pending_approval'::public.fixmate_account_status, 'active'::public.fixmate_account_status)
    )
    AND EXISTS (SELECT 1 FROM public.pilot_service_zones z WHERE z.id = zone_id AND z.is_active)
  );
CREATE POLICY artisan_service_zones_delete_owner
  ON public.artisan_service_zones FOR DELETE TO authenticated
  USING (
    artisan_id = (SELECT auth.uid())
    AND public.fixmate_has_role('artisan'::public.fixmate_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.account_status IN ('pending_approval'::public.fixmate_account_status, 'active'::public.fixmate_account_status)
    )
  );
GRANT SELECT, INSERT, DELETE ON TABLE public.artisan_service_zones TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_mark_artisan_profile_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.fixmate_has_role('administrator'::public.fixmate_role)
    AND (OLD.display_name IS DISTINCT FROM NEW.display_name
      OR OLD.service_categories IS DISTINCT FROM NEW.service_categories
      OR OLD.service_area IS DISTINCT FROM NEW.service_area
      OR OLD.bio IS DISTINCT FROM NEW.bio) THEN
    UPDATE public.profiles
    SET account_status = 'pending_approval'::public.fixmate_account_status, updated_at = now()
    WHERE id = NEW.user_id
      AND account_status = 'active'::public.fixmate_account_status;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS artisan_profile_edit_requires_review ON public.artisan_profiles;
CREATE TRIGGER artisan_profile_edit_requires_review
  AFTER UPDATE ON public.artisan_profiles
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_mark_artisan_profile_pending();

CREATE OR REPLACE FUNCTION public.fixmate_mark_artisan_zone_change_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_artisan_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_artisan_id := OLD.artisan_id; ELSE v_artisan_id := NEW.artisan_id; END IF;
  IF NOT public.fixmate_has_role('administrator'::public.fixmate_role) THEN
    UPDATE public.profiles
    SET account_status = 'pending_approval'::public.fixmate_account_status, updated_at = now()
    WHERE id = v_artisan_id
      AND account_status = 'active'::public.fixmate_account_status;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
DROP TRIGGER IF EXISTS artisan_service_zone_edit_requires_review ON public.artisan_service_zones;
CREATE TRIGGER artisan_service_zone_edit_requires_review
  AFTER INSERT OR UPDATE OR DELETE ON public.artisan_service_zones
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_mark_artisan_zone_change_pending();

DROP POLICY IF EXISTS artisan_profiles_read_own_admin_or_verified ON public.artisan_profiles;
CREATE POLICY artisan_profiles_read_own_admin_or_verified
  ON public.artisan_profiles FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.fixmate_has_role('administrator'::public.fixmate_role)
    OR (public.fixmate_is_verified_artisan(user_id) AND private.fixmate_profile_is_active(user_id))
  );
DROP POLICY IF EXISTS artisan_profiles_update_self ON public.artisan_profiles;
CREATE POLICY artisan_profiles_update_self
  ON public.artisan_profiles FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND public.fixmate_has_role('artisan'::public.fixmate_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.account_status IN ('pending_approval'::public.fixmate_account_status, 'active'::public.fixmate_account_status)
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.fixmate_has_role('artisan'::public.fixmate_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.account_status IN ('pending_approval'::public.fixmate_account_status, 'active'::public.fixmate_account_status)
    )
  );

CREATE TABLE IF NOT EXISTS public.customer_verification_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_photo_path text,
  student_id_path text,
  status public.fixmate_customer_review_status NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('submitted'::public.fixmate_customer_review_status, 'in_review'::public.fixmate_customer_review_status, 'approved'::public.fixmate_customer_review_status) OR (profile_photo_path IS NOT NULL AND student_id_path IS NOT NULL))
);

CREATE OR REPLACE FUNCTION public.fixmate_set_initial_role(p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_role NOT IN ('customer', 'artisan') THEN
    RAISE EXCEPTION 'Only customer or artisan is a selectable account type';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = (SELECT auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_profile.role = 'administrator'::public.fixmate_role THEN
    RAISE EXCEPTION 'Administrator role cannot be changed through onboarding' USING errcode = '42501';
  END IF;
  IF v_profile.account_status <> 'pending_approval'::public.fixmate_account_status THEN
    RAISE EXCEPTION 'Account type can only be selected before approval';
  END IF;
  IF v_profile.role::text = p_role THEN
    RETURN;
  END IF;
  IF v_profile.role <> 'customer'::public.fixmate_role THEN
    RAISE EXCEPTION 'Account type cannot be changed after onboarding starts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_verification_submissions s WHERE s.customer_id = v_profile.id)
    OR EXISTS (SELECT 1 FROM public.artisan_verification_applications a WHERE a.artisan_id = v_profile.id) THEN
    RAISE EXCEPTION 'Account type cannot be changed after verification submission';
  END IF;

  UPDATE public.profiles
  SET role = p_role::public.fixmate_role, updated_at = now()
  WHERE id = v_profile.id;

  IF p_role = 'artisan' THEN
    INSERT INTO public.artisan_profiles (user_id, display_name)
    VALUES (v_profile.id, v_profile.display_name)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fixmate_set_initial_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_set_initial_role(text) TO authenticated;

CREATE INDEX IF NOT EXISTS customer_verification_status_idx ON public.customer_verification_submissions (status, submitted_at);
ALTER TABLE public.customer_verification_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_verification_read_owner_admin ON public.customer_verification_submissions;
DROP POLICY IF EXISTS customer_verification_insert_owner ON public.customer_verification_submissions;
DROP POLICY IF EXISTS customer_verification_update_owner_draft ON public.customer_verification_submissions;
DROP POLICY IF EXISTS customer_verification_admin_all ON public.customer_verification_submissions;
CREATE POLICY customer_verification_read_owner_admin
  ON public.customer_verification_submissions FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()) OR public.fixmate_has_role('administrator'::public.fixmate_role));
CREATE POLICY customer_verification_insert_owner
  ON public.customer_verification_submissions FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = (SELECT auth.uid())
    AND status = 'draft'::public.fixmate_customer_review_status
    AND public.fixmate_has_role('customer'::public.fixmate_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.account_status = 'pending_approval'::public.fixmate_account_status
    )
  );
CREATE POLICY customer_verification_update_owner_draft
  ON public.customer_verification_submissions FOR UPDATE TO authenticated
  USING (
    customer_id = (SELECT auth.uid())
    AND status IN ('draft'::public.fixmate_customer_review_status, 'needs_more_info'::public.fixmate_customer_review_status)
  )
  WITH CHECK (
    customer_id = (SELECT auth.uid())
    AND status IN ('draft'::public.fixmate_customer_review_status, 'submitted'::public.fixmate_customer_review_status)
    AND public.fixmate_has_role('customer'::public.fixmate_role)
  );
CREATE POLICY customer_verification_admin_all
  ON public.customer_verification_submissions FOR ALL TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role))
  WITH CHECK (public.fixmate_has_role('administrator'::public.fixmate_role));
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_verification_submissions TO authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.customer_verification_submissions FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.fixmate_guard_customer_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status public.fixmate_account_status;
  v_role public.fixmate_role;
  v_prefix text;
BEGIN
  IF public.fixmate_has_role('administrator'::public.fixmate_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NEW.customer_id <> (SELECT auth.uid())
      OR NEW.status <> 'draft'::public.fixmate_customer_review_status
      OR NEW.profile_photo_path IS NOT NULL OR NEW.student_id_path IS NOT NULL THEN
      RAISE EXCEPTION 'Customer verification draft is not valid' USING errcode = '42501';
    END IF;
    SELECT p.role, p.account_status INTO v_role, v_status
    FROM public.profiles p WHERE p.id = (SELECT auth.uid());
    IF v_role <> 'customer'::public.fixmate_role OR v_status <> 'pending_approval'::public.fixmate_account_status THEN
      RAISE EXCEPTION 'A pending customer account is required' USING errcode = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.customer_id <> (SELECT auth.uid())
    OR NEW.id <> OLD.id
    OR NEW.customer_id <> OLD.customer_id
    OR OLD.status NOT IN ('draft'::public.fixmate_customer_review_status, 'needs_more_info'::public.fixmate_customer_review_status)
    OR NEW.status NOT IN ('draft'::public.fixmate_customer_review_status, 'submitted'::public.fixmate_customer_review_status) THEN
    RAISE EXCEPTION 'Submitted verification fields are administrator-controlled' USING errcode = '42501';
  END IF;

  v_prefix := (SELECT auth.uid())::text || '/' || NEW.id::text || '/';
  IF NEW.profile_photo_path IS NOT NULL AND left(NEW.profile_photo_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Profile photo must be stored in the current customer submission folder' USING errcode = '42501';
  END IF;
  IF NEW.student_id_path IS NOT NULL AND left(NEW.student_id_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Student ID must be stored in the current customer submission folder' USING errcode = '42501';
  END IF;
  IF NEW.status = 'submitted'::public.fixmate_customer_review_status THEN
    IF NEW.profile_photo_path IS NULL OR NEW.student_id_path IS NULL THEN
      RAISE EXCEPTION 'Profile photo and ABU student ID are required before submission';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'customer'::public.fixmate_role
        AND p.phone IS NOT NULL
        AND btrim(p.phone) <> ''
    ) THEN
      RAISE EXCEPTION 'A WhatsApp contact number is required before customer approval';
    END IF;
    NEW.submitted_at := coalesce(OLD.submitted_at, now());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS customer_verification_submission_guard ON public.customer_verification_submissions;
CREATE TRIGGER customer_verification_submission_guard
  BEFORE INSERT OR UPDATE ON public.customer_verification_submissions
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_guard_customer_submission();

CREATE TABLE IF NOT EXISTS public.customer_verification_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.customer_verification_submissions(id) ON DELETE CASCADE,
  administrator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action public.fixmate_customer_review_status NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_verification_admin_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_verification_admin_notes_admin_read ON public.customer_verification_admin_notes;
CREATE POLICY customer_verification_admin_notes_admin_read
  ON public.customer_verification_admin_notes FOR SELECT TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role));
GRANT SELECT ON TABLE public.customer_verification_admin_notes TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.customer_verification_admin_notes FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.fixmate_account_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  administrator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  previous_status public.fixmate_account_status NOT NULL,
  new_status public.fixmate_account_status NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixmate_account_actions_target_idx ON public.fixmate_account_actions (target_user_id, created_at DESC);
ALTER TABLE public.fixmate_account_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixmate_account_actions_admin_read ON public.fixmate_account_actions;
CREATE POLICY fixmate_account_actions_admin_read
  ON public.fixmate_account_actions FOR SELECT TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role));
GRANT SELECT ON TABLE public.fixmate_account_actions TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.fixmate_account_actions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_admin_review_customer_submission(
  p_submission_id uuid,
  p_status public.fixmate_customer_review_status,
  p_note text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_customer_id uuid;
  v_previous public.fixmate_account_status;
  v_new public.fixmate_account_status;
BEGIN
  IF NOT public.fixmate_has_role('administrator'::public.fixmate_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode = '42501';
  END IF;
  IF p_status NOT IN (
    'in_review'::public.fixmate_customer_review_status,
    'needs_more_info'::public.fixmate_customer_review_status,
    'approved'::public.fixmate_customer_review_status,
    'rejected'::public.fixmate_customer_review_status
  ) THEN
    RAISE EXCEPTION 'Invalid customer review decision';
  END IF;

  SELECT customer_id INTO v_customer_id
  FROM public.customer_verification_submissions
  WHERE id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer verification submission not found'; END IF;

  IF p_status = 'approved'::public.fixmate_customer_review_status THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_verification_submissions s
      WHERE s.id = p_submission_id AND s.profile_photo_path IS NOT NULL AND s.student_id_path IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Both required customer documents must be present before approval';
    END IF;
    v_new := 'active'::public.fixmate_account_status;
  ELSIF p_status = 'rejected'::public.fixmate_customer_review_status THEN
    v_new := 'rejected'::public.fixmate_account_status;
  ELSE
    v_new := 'pending_approval'::public.fixmate_account_status;
  END IF;

  SELECT account_status INTO v_previous FROM public.profiles WHERE id = v_customer_id FOR UPDATE;
  UPDATE public.customer_verification_submissions
  SET status = p_status, submitted_at = coalesce(submitted_at, now()), updated_at = now()
  WHERE id = p_submission_id;
  UPDATE public.profiles SET account_status = v_new, updated_at = now() WHERE id = v_customer_id;
  INSERT INTO public.customer_verification_admin_notes (submission_id, administrator_id, action, note)
  VALUES (p_submission_id, (SELECT auth.uid()), p_status, left(coalesce(p_note, ''), 2000));
  INSERT INTO public.fixmate_account_actions (target_user_id, administrator_id, previous_status, new_status, reason)
  VALUES (v_customer_id, (SELECT auth.uid()), coalesce(v_previous, 'pending_approval'::public.fixmate_account_status), v_new, left(coalesce(p_note, ''), 2000));
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_admin_review_customer_submission(uuid, public.fixmate_customer_review_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_admin_review_customer_submission(uuid, public.fixmate_customer_review_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_admin_set_account_status(
  p_user_id uuid,
  p_new_status public.fixmate_account_status,
  p_reason text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.fixmate_role;
  v_previous public.fixmate_account_status;
BEGIN
  IF NOT public.fixmate_has_role('administrator'::public.fixmate_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode = '42501';
  END IF;
  SELECT role, account_status INTO v_role, v_previous
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  IF v_role = 'administrator'::public.fixmate_role THEN
    RAISE EXCEPTION 'Administrator accounts cannot be restricted through this control';
  END IF;
  IF p_new_status = 'active'::public.fixmate_account_status THEN
    IF v_role = 'customer'::public.fixmate_role AND NOT EXISTS (
      SELECT 1 FROM public.customer_verification_submissions s
      WHERE s.customer_id = p_user_id AND s.status = 'approved'::public.fixmate_customer_review_status
    ) THEN
      RAISE EXCEPTION 'Customer documents must be approved before account activation';
    END IF;
    IF v_role = 'artisan'::public.fixmate_role AND NOT public.fixmate_is_verified_artisan(p_user_id) THEN
      RAISE EXCEPTION 'Artisan verification must be approved before account activation';
    END IF;
  END IF;
  IF p_new_status = 'restricted'::public.fixmate_account_status AND btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required to restrict an account';
  END IF;

  UPDATE public.profiles SET account_status = p_new_status, updated_at = now() WHERE id = p_user_id;
  INSERT INTO public.fixmate_account_actions (target_user_id, administrator_id, previous_status, new_status, reason)
  VALUES (p_user_id, (SELECT auth.uid()), v_previous, p_new_status, left(coalesce(p_reason, ''), 2000));
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_admin_set_account_status(uuid, public.fixmate_account_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_admin_set_account_status(uuid, public.fixmate_account_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_sync_artisan_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF new.status IS DISTINCT FROM old.status THEN
    IF new.status = 'approved'::public.fixmate_application_status THEN
      UPDATE public.profiles SET account_status = 'active'::public.fixmate_account_status, updated_at = now()
      WHERE id = new.artisan_id AND role = 'artisan'::public.fixmate_role;
    ELSIF new.status = 'rejected'::public.fixmate_application_status THEN
      UPDATE public.profiles SET account_status = 'rejected'::public.fixmate_account_status, updated_at = now()
      WHERE id = new.artisan_id AND role = 'artisan'::public.fixmate_role;
    ELSIF new.status IN ('suspended'::public.fixmate_application_status, 'revoked'::public.fixmate_application_status) THEN
      UPDATE public.profiles SET account_status = 'restricted'::public.fixmate_account_status, updated_at = now()
      WHERE id = new.artisan_id AND role = 'artisan'::public.fixmate_role;
    ELSIF old.status = 'approved'::public.fixmate_application_status
      AND new.status IN ('in_review'::public.fixmate_application_status, 'needs_more_info'::public.fixmate_application_status) THEN
      UPDATE public.profiles SET account_status = 'pending_approval'::public.fixmate_account_status, updated_at = now()
      WHERE id = new.artisan_id AND role = 'artisan'::public.fixmate_role;
    END IF;
  END IF;
  RETURN new;
END;
$function$;
DROP TRIGGER IF EXISTS artisan_license_sync_after_review ON public.artisan_verification_applications;
DROP TRIGGER IF EXISTS artisan_profile_account_status_after_review ON public.artisan_verification_applications;
CREATE TRIGGER artisan_profile_account_status_after_review
  AFTER UPDATE OF status ON public.artisan_verification_applications
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_sync_artisan_account_status();

CREATE OR REPLACE FUNCTION public.fixmate_require_artisan_profile_before_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_phone text;
  v_display_name text;
  v_categories public.fixmate_service_category[];
BEGIN
  IF new.status NOT IN ('submitted'::public.fixmate_application_status, 'approved'::public.fixmate_application_status) THEN
    RETURN new;
  END IF;
  SELECT p.phone, ap.display_name, ap.service_categories
  INTO v_phone, v_display_name, v_categories
  FROM public.profiles p
  JOIN public.artisan_profiles ap ON ap.user_id = p.id
  WHERE p.id = new.artisan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artisan profile is required before review'; END IF;
  IF v_phone IS NULL OR btrim(v_phone) = '' THEN RAISE EXCEPTION 'Artisan WhatsApp contact is required before review'; END IF;
  IF v_display_name IS NULL OR btrim(v_display_name) = '' THEN RAISE EXCEPTION 'Artisan profile name is required before review'; END IF;
  IF coalesce(cardinality(v_categories), 0) = 0 THEN RAISE EXCEPTION 'Select at least one approved service category'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.artisan_service_zones z
    JOIN public.pilot_service_zones pz ON pz.id = z.zone_id
    WHERE z.artisan_id = new.artisan_id AND pz.is_active
  ) THEN
    RAISE EXCEPTION 'Select at least one active ABU Main Campus service zone';
  END IF;
  RETURN new;
END;
$function$;
DROP TRIGGER IF EXISTS artisan_verification_application_requirements ON public.artisan_verification_applications;
CREATE TRIGGER artisan_verification_application_requirements
  BEFORE INSERT OR UPDATE OF status ON public.artisan_verification_applications
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_require_artisan_profile_before_review();

DROP POLICY IF EXISTS verification_applications_insert_owner_or_admin ON public.artisan_verification_applications;
CREATE POLICY verification_applications_insert_owner_or_admin
  ON public.artisan_verification_applications FOR INSERT TO authenticated
  WITH CHECK (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR (
      artisan_id = (SELECT auth.uid())
      AND status = 'draft'::public.fixmate_application_status
      AND public.fixmate_has_role('artisan'::public.fixmate_role)
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.account_status IN ('pending_approval'::public.fixmate_account_status, 'active'::public.fixmate_account_status))
    )
  );

DROP POLICY IF EXISTS artisan_licenses_delete_admin ON public.artisan_licenses;
DROP POLICY IF EXISTS artisan_licenses_insert_admin ON public.artisan_licenses;
DROP POLICY IF EXISTS artisan_licenses_read_owner_or_admin ON public.artisan_licenses;
DROP POLICY IF EXISTS artisan_licenses_update_admin ON public.artisan_licenses;
COMMENT ON TABLE public.artisan_licenses IS 'Legacy FixMate license table retained for historical compatibility only; application API policies are disabled. FixMate does not issue government licences.';

DROP POLICY IF EXISTS fixmate_verification_objects_insert_owner ON storage.objects;
CREATE POLICY fixmate_verification_objects_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fixmate-verification'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      EXISTS (
        SELECT 1 FROM public.artisan_verification_applications a
        WHERE a.id::text = (storage.foldername(name))[2]
          AND a.artisan_id = (SELECT auth.uid())
          AND a.status IN ('draft'::public.fixmate_application_status, 'needs_more_info'::public.fixmate_application_status)
      )
      OR EXISTS (
        SELECT 1 FROM public.customer_verification_submissions s
        WHERE s.id::text = (storage.foldername(name))[2]
          AND s.customer_id = (SELECT auth.uid())
          AND s.status IN ('draft'::public.fixmate_customer_review_status, 'needs_more_info'::public.fixmate_customer_review_status)
      )
    )
  );

DROP POLICY IF EXISTS fixmate_verification_objects_read_owner_or_admin ON storage.objects;
CREATE POLICY fixmate_verification_objects_read_owner_or_admin
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'fixmate-verification'
    AND (
      public.fixmate_has_role('administrator'::public.fixmate_role)
      OR EXISTS (
        SELECT 1 FROM public.artisan_verification_documents d
        WHERE d.storage_path = name AND d.uploaded_by = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.customer_verification_submissions s
        WHERE s.customer_id = (SELECT auth.uid())
          AND s.id::text = (storage.foldername(name))[2]
          AND name IN (s.profile_photo_path, s.student_id_path)
      )
    )
  );

DROP POLICY IF EXISTS fixmate_verification_objects_delete_owner_draft ON storage.objects;
CREATE POLICY fixmate_verification_objects_delete_owner_draft
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'fixmate-verification'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      EXISTS (
        SELECT 1 FROM public.artisan_verification_applications a
        WHERE a.id::text = (storage.foldername(name))[2]
          AND a.artisan_id = (SELECT auth.uid())
          AND a.status IN ('draft'::public.fixmate_application_status, 'needs_more_info'::public.fixmate_application_status)
      )
      OR EXISTS (
        SELECT 1 FROM public.customer_verification_submissions s
        WHERE s.id::text = (storage.foldername(name))[2]
          AND s.customer_id = (SELECT auth.uid())
          AND s.status IN ('draft'::public.fixmate_customer_review_status, 'needs_more_info'::public.fixmate_customer_review_status)
      )
    )
  );

DROP POLICY IF EXISTS fixmate_verification_objects_update_owner_draft ON storage.objects;
CREATE POLICY fixmate_verification_objects_update_owner_draft
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fixmate-verification'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      EXISTS (
        SELECT 1 FROM public.artisan_verification_applications a
        WHERE a.id::text = (storage.foldername(name))[2]
          AND a.artisan_id = (SELECT auth.uid())
          AND a.status IN ('draft'::public.fixmate_application_status, 'needs_more_info'::public.fixmate_application_status)
      )
      OR EXISTS (
        SELECT 1 FROM public.customer_verification_submissions s
        WHERE s.id::text = (storage.foldername(name))[2]
          AND s.customer_id = (SELECT auth.uid())
          AND s.status IN ('draft'::public.fixmate_customer_review_status, 'needs_more_info'::public.fixmate_customer_review_status)
      )
    )
  )
  WITH CHECK (
    bucket_id = 'fixmate-verification'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      EXISTS (
        SELECT 1 FROM public.artisan_verification_applications a
        WHERE a.id::text = (storage.foldername(name))[2]
          AND a.artisan_id = (SELECT auth.uid())
          AND a.status IN ('draft'::public.fixmate_application_status, 'needs_more_info'::public.fixmate_application_status)
      )
      OR EXISTS (
        SELECT 1 FROM public.customer_verification_submissions s
        WHERE s.id::text = (storage.foldername(name))[2]
          AND s.customer_id = (SELECT auth.uid())
          AND s.status IN ('draft'::public.fixmate_customer_review_status, 'needs_more_info'::public.fixmate_customer_review_status)
      )
    )
  );
