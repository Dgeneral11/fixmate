CREATE OR REPLACE FUNCTION private.fixmate_can_view_request(p_request_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND (p_user_id = (SELECT auth.uid()) OR public.fixmate_has_role('administrator'::public.fixmate_role))
    AND EXISTS (
      SELECT 1
      FROM public.customer_requests r
      JOIN public.profiles p ON p.id = p_user_id
      WHERE r.id = p_request_id
        AND p.account_status = 'active'::public.fixmate_account_status
        AND (
          r.customer_id = p_user_id
          OR EXISTS (
            SELECT 1 FROM public.artisan_offers o
            WHERE o.request_id = r.id AND o.artisan_id = p_user_id
          )
          OR (
            p.role = 'artisan'::public.fixmate_role
            AND r.status = 'open'::public.fixmate_request_status
            AND public.fixmate_is_verified_artisan(p_user_id)
            AND EXISTS (
              SELECT 1 FROM public.artisan_profiles ap
              WHERE ap.user_id = p_user_id
                AND ap.is_available
                AND r.service_category = ANY(ap.service_categories)
            )
            AND EXISTS (
              SELECT 1 FROM public.artisan_service_zones az
              JOIN public.pilot_service_zones z ON z.id = az.zone_id
              WHERE az.artisan_id = p_user_id AND az.zone_id = r.zone_id AND z.is_active
            )
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.fixmate_can_offer(p_request_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.customer_requests r
      JOIN public.profiles p ON p.id = p_user_id
      JOIN public.artisan_profiles ap ON ap.user_id = p_user_id
      JOIN public.artisan_service_zones az ON az.artisan_id = p_user_id AND az.zone_id = r.zone_id
      JOIN public.pilot_service_zones z ON z.id = az.zone_id AND z.is_active
      WHERE r.id = p_request_id
        AND r.status = 'open'::public.fixmate_request_status
        AND p.role = 'artisan'::public.fixmate_role
        AND p.account_status = 'active'::public.fixmate_account_status
        AND ap.is_available
        AND public.fixmate_is_verified_artisan(p_user_id)
        AND r.service_category = ANY(ap.service_categories)
    );
$function$;

CREATE OR REPLACE FUNCTION public.fixmate_admin_restore_account(p_user_id uuid, p_reason text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_role public.fixmate_role;
  v_current public.fixmate_account_status;
  v_previous public.fixmate_account_status;
  v_target public.fixmate_account_status;
BEGIN
  IF NOT public.fixmate_has_role('administrator'::public.fixmate_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode = '42501';
  END IF;

  SELECT role, account_status INTO v_role, v_current
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
  IF v_role = 'administrator'::public.fixmate_role THEN
    RAISE EXCEPTION 'Administrator accounts cannot be restored through this control';
  END IF;
  IF v_current <> 'restricted'::public.fixmate_account_status THEN
    RAISE EXCEPTION 'Only a restricted account can be restored';
  END IF;

  SELECT a.previous_status INTO v_previous
  FROM public.fixmate_account_actions a
  WHERE a.target_user_id = p_user_id
    AND a.new_status = 'restricted'::public.fixmate_account_status
    AND a.previous_status <> 'restricted'::public.fixmate_account_status
  ORDER BY a.created_at DESC
  LIMIT 1;
  v_target := coalesce(v_previous, 'pending_approval'::public.fixmate_account_status);

  IF v_target = 'active'::public.fixmate_account_status THEN
    IF v_role = 'customer'::public.fixmate_role AND NOT EXISTS (
      SELECT 1 FROM public.customer_verification_submissions s
      WHERE s.customer_id = p_user_id AND s.status = 'approved'::public.fixmate_customer_review_status
    ) THEN
      v_target := 'pending_approval'::public.fixmate_account_status;
    ELSIF v_role = 'artisan'::public.fixmate_role AND NOT public.fixmate_is_verified_artisan(p_user_id) THEN
      v_target := 'pending_approval'::public.fixmate_account_status;
    END IF;
  END IF;

  UPDATE public.profiles SET account_status = v_target, updated_at = now() WHERE id = p_user_id;
  INSERT INTO public.fixmate_account_actions (target_user_id, administrator_id, previous_status, new_status, reason)
  VALUES (
    p_user_id,
    (SELECT auth.uid()),
    v_current,
    v_target,
    left(coalesce(nullif(btrim(p_reason), ''), 'Restored by administrator'), 2000)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_admin_restore_account(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_admin_restore_account(uuid, text) TO authenticated;
