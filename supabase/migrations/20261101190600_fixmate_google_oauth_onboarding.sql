-- Persist the account type chosen after the user returns from Google OAuth.
-- Existing profiles are considered already classified; new profiles default to
-- unselected so the client can show the one-time Customer/Artisan step.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type_selected boolean;

UPDATE public.profiles
SET account_type_selected = true
WHERE account_type_selected IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN account_type_selected SET DEFAULT false,
  ALTER COLUMN account_type_selected SET NOT NULL;

GRANT SELECT (account_type_selected) ON TABLE public.profiles TO authenticated;

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

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = (SELECT auth.uid())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_profile.role = 'administrator'::public.fixmate_role THEN
    RAISE EXCEPTION 'Administrator role cannot be changed through onboarding' USING errcode = '42501';
  END IF;
  IF v_profile.account_status <> 'pending_approval'::public.fixmate_account_status THEN
    RAISE EXCEPTION 'Account type can only be selected before approval';
  END IF;

  IF v_profile.account_type_selected THEN
    IF v_profile.role::text <> p_role THEN
      RAISE EXCEPTION 'Account type has already been selected';
    END IF;
    RETURN;
  END IF;

  IF v_profile.role::text = p_role THEN
    UPDATE public.profiles
    SET account_type_selected = true, updated_at = now()
    WHERE id = v_profile.id;
    IF p_role = 'artisan' THEN
      INSERT INTO public.artisan_profiles (user_id, display_name)
      VALUES (v_profile.id, v_profile.display_name)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN;
  END IF;

  IF v_profile.role <> 'customer'::public.fixmate_role THEN
    RAISE EXCEPTION 'Account type cannot be changed after onboarding starts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_verification_submissions s
    WHERE s.customer_id = v_profile.id
  ) OR EXISTS (
    SELECT 1 FROM public.artisan_verification_applications a
    WHERE a.artisan_id = v_profile.id
  ) THEN
    RAISE EXCEPTION 'Account type cannot be changed after verification submission';
  END IF;

  UPDATE public.profiles
  SET role = p_role::public.fixmate_role,
      account_type_selected = true,
      updated_at = now()
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
