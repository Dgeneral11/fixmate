-- Approved FixMate review corrections (2026-11-06).
-- Additive changes only: preserve existing IDs, requests, offers, reviews, and audit rows.

-- Customer eligibility: existing rows keep their student status and existing file path.
ALTER TABLE public.customer_verification_submissions
  ADD COLUMN IF NOT EXISTS is_student boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alternative_id_type text,
  ADD COLUMN IF NOT EXISTS alternative_id_path text;

ALTER TABLE public.customer_verification_submissions
  DROP CONSTRAINT IF EXISTS customer_verification_submissions_check,
  DROP CONSTRAINT IF EXISTS customer_verification_alternative_id_type_check,
  DROP CONSTRAINT IF EXISTS customer_verification_student_or_alternative_id_check;

ALTER TABLE public.customer_verification_submissions
  ADD CONSTRAINT customer_verification_submissions_check
    CHECK (
      status NOT IN (
        'submitted'::public.fixmate_customer_review_status,
        'in_review'::public.fixmate_customer_review_status,
        'approved'::public.fixmate_customer_review_status
      )
      OR (
        profile_photo_path IS NOT NULL
        AND (
          (is_student AND student_id_path IS NOT NULL AND alternative_id_path IS NULL)
          OR
          (NOT is_student AND student_id_path IS NULL AND alternative_id_type IS NOT NULL AND alternative_id_path IS NOT NULL)
        )
      )
    ),
  ADD CONSTRAINT customer_verification_alternative_id_type_check
    CHECK (alternative_id_type IS NULL OR alternative_id_type IN ('nin', 'passport', 'drivers_license', 'voters_card', 'other_government_id')),
  ADD CONSTRAINT customer_verification_student_or_alternative_id_check
    CHECK (
      (is_student AND alternative_id_type IS NULL AND alternative_id_path IS NULL)
      OR
      (NOT is_student AND student_id_path IS NULL)
    );

-- Existing table permissions are column-scoped; grant access only to the new customer-owned fields.
GRANT SELECT (is_student, alternative_id_type, alternative_id_path),
  INSERT (is_student, alternative_id_type, alternative_id_path),
  UPDATE (is_student, alternative_id_type, alternative_id_path)
  ON TABLE public.customer_verification_submissions TO authenticated;

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
      OR NEW.profile_photo_path IS NOT NULL
      OR NEW.student_id_path IS NOT NULL
      OR NEW.alternative_id_path IS NOT NULL THEN
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
  IF NEW.alternative_id_path IS NOT NULL AND left(NEW.alternative_id_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'Alternative ID must be stored in the current customer submission folder' USING errcode = '42501';
  END IF;

  IF NEW.is_student AND (NEW.alternative_id_type IS NOT NULL OR NEW.alternative_id_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Students must submit a student ID, not an alternative-ID document';
  END IF;
  IF NOT NEW.is_student AND NEW.student_id_path IS NOT NULL THEN
    RAISE EXCEPTION 'Non-students must submit an alternative government-issued ID';
  END IF;
  IF NEW.alternative_id_type IS NOT NULL AND NEW.alternative_id_type NOT IN ('nin', 'passport', 'drivers_license', 'voters_card', 'other_government_id') THEN
    RAISE EXCEPTION 'Choose an accepted alternative government-issued ID type';
  END IF;

  IF NEW.status = 'submitted'::public.fixmate_customer_review_status THEN
    IF NEW.profile_photo_path IS NULL
      OR (NEW.is_student AND NEW.student_id_path IS NULL)
      OR (NOT NEW.is_student AND (NEW.alternative_id_type IS NULL OR NEW.alternative_id_path IS NULL)) THEN
      RAISE EXCEPTION 'A profile photo and the ID appropriate to your student status are required before submission';
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
    -- A resubmission after more information was requested gets a fresh 12-hour review window.
    NEW.submitted_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

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
      WHERE s.id = p_submission_id
        AND s.profile_photo_path IS NOT NULL
        AND (
          (s.is_student AND s.student_id_path IS NOT NULL)
          OR
          (NOT s.is_student AND s.alternative_id_type IS NOT NULL AND s.alternative_id_path IS NOT NULL)
        )
    ) THEN
      RAISE EXCEPTION 'A profile photo and the appropriate customer ID must be present before approval';
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
          AND name IN (s.profile_photo_path, s.student_id_path, s.alternative_id_path)
      )
    )
  );

-- Direct requests target exactly one chosen, available artisan. Matched requests keep target_artisan_id NULL.
ALTER TABLE public.customer_requests
  ADD COLUMN IF NOT EXISTS target_artisan_id uuid REFERENCES public.artisan_profiles(user_id) ON DELETE RESTRICT;
GRANT SELECT (target_artisan_id), INSERT (target_artisan_id)
  ON TABLE public.customer_requests TO authenticated;
CREATE INDEX IF NOT EXISTS customer_requests_target_artisan_idx
  ON public.customer_requests (target_artisan_id, status, created_at DESC);

-- Private bucket separated from identity/qualification evidence.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fixmate-marketplace-media', 'fixmate-marketplace-media', false, 8388608, ARRAY['image/jpeg', 'image/png']::text[])
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = 8388608, allowed_mime_types = ARRAY['image/jpeg', 'image/png']::text[];

CREATE TABLE IF NOT EXISTS public.customer_request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.customer_requests(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path ~ '^request-attachments/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$')
);
CREATE INDEX IF NOT EXISTS customer_request_attachments_request_idx
  ON public.customer_request_attachments (request_id, created_at);
ALTER TABLE public.customer_request_attachments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.artisan_portfolio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artisan_id uuid NOT NULL REFERENCES public.artisan_profiles(user_id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  caption text NOT NULL DEFAULT '' CHECK (char_length(btrim(caption)) <= 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path ~ '^artisan-portfolio/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$')
);
CREATE INDEX IF NOT EXISTS artisan_portfolio_items_artisan_idx
  ON public.artisan_portfolio_items (artisan_id, created_at DESC);
ALTER TABLE public.artisan_portfolio_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.fixmate_request_id_from_media_path(p_path text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_parts text[];
BEGIN
  v_parts := storage.foldername(p_path);
  IF coalesce(array_length(v_parts, 1), 0) <> 3
    OR v_parts[1] <> 'request-attachments'
    OR v_parts[2] !~ '^[0-9a-fA-F-]{36}$'
    OR v_parts[3] !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_parts[3]::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fixmate_can_upload_request_media(p_path text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = (SELECT auth.uid())
    AND (storage.foldername(p_path))[1] = 'request-attachments'
    AND (storage.foldername(p_path))[2] = p_user_id::text
    AND EXISTS (
      SELECT 1 FROM public.customer_requests r
      WHERE r.id = private.fixmate_request_id_from_media_path(p_path)
        AND r.customer_id = p_user_id
        AND r.status = 'open'::public.fixmate_request_status
    );
$function$;

CREATE OR REPLACE FUNCTION private.fixmate_can_upload_artisan_portfolio(p_path text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = (SELECT auth.uid())
    AND (storage.foldername(p_path))[1] = 'artisan-portfolio'
    AND (storage.foldername(p_path))[2] = p_user_id::text
    AND public.fixmate_has_role('artisan'::public.fixmate_role)
    AND private.fixmate_profile_is_active(p_user_id)
    AND public.fixmate_is_verified_artisan(p_user_id);
$function$;

REVOKE ALL ON FUNCTION private.fixmate_request_id_from_media_path(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_can_upload_request_media(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_can_upload_artisan_portfolio(text, uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_request_id_from_media_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_can_upload_request_media(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_can_upload_artisan_portfolio(text, uuid) TO authenticated;

DROP POLICY IF EXISTS fixmate_request_attachments_read_participants_admin ON public.customer_request_attachments;
CREATE POLICY fixmate_request_attachments_read_participants_admin
  ON public.customer_request_attachments FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR private.fixmate_can_view_request(request_id, (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS fixmate_request_attachments_insert_customer_owner ON public.customer_request_attachments;
CREATE POLICY fixmate_request_attachments_insert_customer_owner
  ON public.customer_request_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND private.fixmate_can_upload_request_media(storage_path, (SELECT auth.uid()))
    AND request_id = private.fixmate_request_id_from_media_path(storage_path)
  );
DROP POLICY IF EXISTS fixmate_request_attachments_delete_customer_owner ON public.customer_request_attachments;
CREATE POLICY fixmate_request_attachments_delete_customer_owner
  ON public.customer_request_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.customer_requests r
      WHERE r.id = request_id AND r.customer_id = (SELECT auth.uid())
        AND r.status = 'open'::public.fixmate_request_status
    )
  );
GRANT SELECT, INSERT, DELETE ON TABLE public.customer_request_attachments TO authenticated;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.customer_request_attachments FROM anon, authenticated;

DROP POLICY IF EXISTS artisan_portfolio_read_owner_customer_admin ON public.artisan_portfolio_items;
CREATE POLICY artisan_portfolio_read_owner_customer_admin
  ON public.artisan_portfolio_items FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR artisan_id = (SELECT auth.uid())
    OR (
      public.fixmate_has_role('customer'::public.fixmate_role)
      AND private.fixmate_profile_is_active((SELECT auth.uid()))
      AND public.fixmate_is_verified_artisan(artisan_id)
    )
  );
DROP POLICY IF EXISTS artisan_portfolio_insert_owner ON public.artisan_portfolio_items;
CREATE POLICY artisan_portfolio_insert_owner
  ON public.artisan_portfolio_items FOR INSERT TO authenticated
  WITH CHECK (
    artisan_id = (SELECT auth.uid())
    AND private.fixmate_can_upload_artisan_portfolio(storage_path, (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS artisan_portfolio_delete_owner_admin ON public.artisan_portfolio_items;
CREATE POLICY artisan_portfolio_delete_owner_admin
  ON public.artisan_portfolio_items FOR DELETE TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR (artisan_id = (SELECT auth.uid()) AND public.fixmate_has_role('artisan'::public.fixmate_role))
  );
GRANT SELECT, INSERT, DELETE ON TABLE public.artisan_portfolio_items TO authenticated;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.artisan_portfolio_items FROM anon, authenticated;

DROP POLICY IF EXISTS fixmate_marketplace_media_insert_owner ON storage.objects;
CREATE POLICY fixmate_marketplace_media_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fixmate-marketplace-media'
    AND (
      private.fixmate_can_upload_request_media(name, (SELECT auth.uid()))
      OR private.fixmate_can_upload_artisan_portfolio(name, (SELECT auth.uid()))
    )
  );
DROP POLICY IF EXISTS fixmate_marketplace_media_read_authorized ON storage.objects;
CREATE POLICY fixmate_marketplace_media_read_authorized
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'fixmate-marketplace-media'
    AND (
      public.fixmate_has_role('administrator'::public.fixmate_role)
      OR EXISTS (
        SELECT 1 FROM public.customer_request_attachments a
        WHERE a.storage_path = name
          AND private.fixmate_can_view_request(a.request_id, (SELECT auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.artisan_portfolio_items i
        WHERE i.storage_path = name
          AND (
            i.artisan_id = (SELECT auth.uid())
            OR (
              public.fixmate_has_role('customer'::public.fixmate_role)
              AND private.fixmate_profile_is_active((SELECT auth.uid()))
              AND public.fixmate_is_verified_artisan(i.artisan_id)
            )
          )
      )
    )
  );
DROP POLICY IF EXISTS fixmate_marketplace_media_delete_owner ON storage.objects;
CREATE POLICY fixmate_marketplace_media_delete_owner
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'fixmate-marketplace-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.customer_request_attachments a
        JOIN public.customer_requests r ON r.id = a.request_id
        WHERE a.storage_path = name AND a.uploaded_by = (SELECT auth.uid())
          AND r.customer_id = (SELECT auth.uid())
          AND r.status = 'open'::public.fixmate_request_status
      )
      OR EXISTS (
        SELECT 1 FROM public.artisan_portfolio_items i
        WHERE i.storage_path = name AND i.artisan_id = (SELECT auth.uid())
      )
      OR public.fixmate_has_role('administrator'::public.fixmate_role)
    )
  );

-- Directly targeted requests are visible only to their customer, chosen artisan, offers participants, and admins.
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
            r.target_artisan_id = p_user_id
            AND p.role = 'artisan'::public.fixmate_role
            AND public.fixmate_is_verified_artisan(p_user_id)
          )
          OR (
            r.target_artisan_id IS NULL
            AND p.role = 'artisan'::public.fixmate_role
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

CREATE OR REPLACE FUNCTION private.fixmate_is_request_participant(p_request_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND (p_user_id = (SELECT auth.uid()) OR public.fixmate_has_role('administrator'::public.fixmate_role))
    AND EXISTS (
      SELECT 1 FROM public.customer_requests r
      WHERE r.id = p_request_id
        AND (
          r.customer_id = p_user_id
          OR r.target_artisan_id = p_user_id
          OR EXISTS (
            SELECT 1 FROM public.artisan_offers o
            WHERE o.request_id = r.id AND o.artisan_id = p_user_id
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
      WHERE r.id = p_request_id
        AND r.status = 'open'::public.fixmate_request_status
        AND p.role = 'artisan'::public.fixmate_role
        AND p.account_status = 'active'::public.fixmate_account_status
        AND ap.is_available
        AND public.fixmate_is_verified_artisan(p_user_id)
        AND (
          (
            r.target_artisan_id IS NOT NULL
            AND r.target_artisan_id = p_user_id
            AND r.service_category = ANY(ap.service_categories)
          )
          OR
          (
            r.target_artisan_id IS NULL
            AND r.service_category = ANY(ap.service_categories)
            AND EXISTS (
              SELECT 1 FROM public.artisan_service_zones az
              JOIN public.pilot_service_zones z ON z.id = az.zone_id
              WHERE az.artisan_id = p_user_id AND az.zone_id = r.zone_id AND z.is_active
            )
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION private.fixmate_can_view_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_is_request_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_can_offer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fixmate_can_view_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_is_request_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_can_offer(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS customer_requests_insert_active_customer ON public.customer_requests;
CREATE POLICY customer_requests_insert_active_customer
  ON public.customer_requests FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = (SELECT auth.uid())
    AND status = 'open'::public.fixmate_request_status
    AND public.fixmate_has_role('customer'::public.fixmate_role)
    AND private.fixmate_profile_is_active((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.pilot_service_zones z
      WHERE z.id = zone_id AND z.is_active
    )
    AND (
      target_artisan_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.artisan_profiles ap
        JOIN public.profiles artisan_account ON artisan_account.id = ap.user_id
        WHERE ap.user_id = target_artisan_id
          AND ap.is_available
          AND service_category = ANY(ap.service_categories)
          AND artisan_account.role = 'artisan'::public.fixmate_role
          AND artisan_account.account_status = 'active'::public.fixmate_account_status
          AND public.fixmate_is_verified_artisan(ap.user_id)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.fixmate_customer_respond_to_offer(p_offer_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_request_id uuid;
  v_customer_id uuid;
  v_artisan_id uuid;
  v_request_status public.fixmate_request_status;
  v_offer_status public.fixmate_offer_status;
  v_active_jobs integer;
BEGIN
  IF NOT public.fixmate_has_role('customer'::public.fixmate_role)
    OR NOT private.fixmate_profile_is_active((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'An approved customer account is required' USING errcode = '42501';
  END IF;
  SELECT o.request_id, r.customer_id, o.artisan_id, r.status, o.status
  INTO v_request_id, v_customer_id, v_artisan_id, v_request_status, v_offer_status
  FROM public.artisan_offers o
  JOIN public.customer_requests r ON r.id = o.request_id
  WHERE o.id = p_offer_id
  FOR UPDATE OF r, o;
  IF NOT FOUND OR v_customer_id <> (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Offer not found for this customer' USING errcode = '42501';
  END IF;
  IF v_request_status <> 'open'::public.fixmate_request_status
    OR v_offer_status <> 'pending'::public.fixmate_offer_status THEN
    RAISE EXCEPTION 'This offer is no longer pending';
  END IF;
  IF p_accept THEN
    IF NOT private.fixmate_profile_is_active(v_artisan_id)
      OR NOT public.fixmate_is_verified_artisan(v_artisan_id) THEN
      RAISE EXCEPTION 'This artisan is not currently available as a verified provider';
    END IF;
    -- Serializes acceptances for this artisan; the following count cannot race another acceptance.
    PERFORM 1 FROM public.artisan_profiles ap WHERE ap.user_id = v_artisan_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This artisan profile is unavailable'; END IF;
    SELECT count(*)::integer INTO v_active_jobs
    FROM public.customer_requests r
    JOIN public.artisan_offers o ON o.request_id = r.id
    WHERE o.artisan_id = v_artisan_id
      AND o.status = 'accepted'::public.fixmate_offer_status
      AND r.status = 'accepted'::public.fixmate_request_status;
    IF v_active_jobs >= 2 THEN
      RAISE EXCEPTION 'This artisan already has two accepted unfinished jobs. Please choose another artisan or try again later.';
    END IF;

    UPDATE public.artisan_offers
    SET status = 'declined'::public.fixmate_offer_status, updated_at = now()
    WHERE request_id = v_request_id
      AND status = 'pending'::public.fixmate_offer_status
      AND id <> p_offer_id;
    UPDATE public.artisan_offers
    SET status = 'accepted'::public.fixmate_offer_status, updated_at = now()
    WHERE id = p_offer_id;
    UPDATE public.customer_requests
    SET status = 'accepted'::public.fixmate_request_status, updated_at = now()
    WHERE id = v_request_id;
  ELSE
    UPDATE public.artisan_offers
    SET status = 'declined'::public.fixmate_offer_status, updated_at = now()
    WHERE id = p_offer_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_customer_respond_to_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_customer_respond_to_offer(uuid, boolean) TO authenticated;

-- Read-only public review details omit customer IDs/contact information.
CREATE OR REPLACE FUNCTION public.fixmate_public_artisan_reviews(p_artisan_id uuid)
RETURNS TABLE (rating smallint, review text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT private.fixmate_profile_is_active((SELECT auth.uid()))
    OR NOT public.fixmate_has_role('customer'::public.fixmate_role) THEN
    RAISE EXCEPTION 'An approved customer account is required' USING errcode = '42501';
  END IF;
  IF NOT public.fixmate_is_verified_artisan(p_artisan_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT r.rating, r.review, r.created_at
  FROM public.job_reviews r
  WHERE r.artisan_id = p_artisan_id
  ORDER BY r.created_at DESC
  LIMIT 25;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_public_artisan_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_public_artisan_reviews(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_public_artisan_review_summary(p_artisan_id uuid)
RETURNS TABLE (review_count bigint, average_rating numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT private.fixmate_profile_is_active((SELECT auth.uid()))
    OR NOT public.fixmate_has_role('customer'::public.fixmate_role) THEN
    RAISE EXCEPTION 'An approved customer account is required' USING errcode = '42501';
  END IF;
  IF NOT public.fixmate_is_verified_artisan(p_artisan_id) THEN
    RETURN QUERY SELECT 0::bigint, NULL::numeric;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT count(*)::bigint, round(avg(r.rating)::numeric, 2)
  FROM public.job_reviews r
  WHERE r.artisan_id = p_artisan_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_public_artisan_review_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_public_artisan_review_summary(uuid) TO authenticated;

-- Auditable job history; never store message bodies or identity data here.
CREATE TABLE IF NOT EXISTS public.fixmate_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.customer_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('request_posted', 'request_status_changed', 'offer_sent', 'offer_status_changed', 'review_submitted')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixmate_request_events_request_idx
  ON public.fixmate_request_events (request_id, created_at);
CREATE INDEX IF NOT EXISTS fixmate_request_events_created_idx
  ON public.fixmate_request_events (created_at DESC);
ALTER TABLE public.fixmate_request_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixmate_request_events_read_participants_admin ON public.fixmate_request_events;
CREATE POLICY fixmate_request_events_read_participants_admin
  ON public.fixmate_request_events FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR private.fixmate_is_request_participant(request_id, (SELECT auth.uid()))
  );
GRANT SELECT ON TABLE public.fixmate_request_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.fixmate_request_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_record_request_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details)
    VALUES (NEW.id, NEW.customer_id, 'request_posted', jsonb_build_object('targeted', NEW.target_artisan_id IS NOT NULL, 'status', NEW.status::text));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details)
    VALUES (NEW.id, (SELECT auth.uid()), 'request_status_changed', jsonb_build_object('from', OLD.status::text, 'to', NEW.status::text));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fixmate_record_offer_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_actor := NEW.artisan_id;
    INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details)
    VALUES (NEW.request_id, v_actor, 'offer_sent', jsonb_build_object('status', NEW.status::text, 'quote_ngn', NEW.quote_ngn));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_actor := coalesce((SELECT auth.uid()), NEW.artisan_id);
    INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details)
    VALUES (NEW.request_id, v_actor, 'offer_status_changed', jsonb_build_object('from', OLD.status::text, 'to', NEW.status::text, 'quote_ngn', NEW.quote_ngn));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fixmate_record_review_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details)
  VALUES (NEW.request_id, NEW.customer_id, 'review_submitted', jsonb_build_object('rating', NEW.rating));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS fixmate_request_event_after_insert ON public.customer_requests;
CREATE TRIGGER fixmate_request_event_after_insert
  AFTER INSERT ON public.customer_requests
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_record_request_event();
DROP TRIGGER IF EXISTS fixmate_request_event_after_status ON public.customer_requests;
CREATE TRIGGER fixmate_request_event_after_status
  AFTER UPDATE OF status ON public.customer_requests
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_record_request_event();
DROP TRIGGER IF EXISTS fixmate_offer_event_after_insert ON public.artisan_offers;
CREATE TRIGGER fixmate_offer_event_after_insert
  AFTER INSERT ON public.artisan_offers
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_record_offer_event();
DROP TRIGGER IF EXISTS fixmate_offer_event_after_status ON public.artisan_offers;
CREATE TRIGGER fixmate_offer_event_after_status
  AFTER UPDATE OF status ON public.artisan_offers
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_record_offer_event();
DROP TRIGGER IF EXISTS fixmate_review_event_after_insert ON public.job_reviews;
CREATE TRIGGER fixmate_review_event_after_insert
  AFTER INSERT ON public.job_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_record_review_event();

REVOKE ALL ON FUNCTION public.fixmate_record_request_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fixmate_record_offer_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fixmate_record_review_event() FROM PUBLIC, anon, authenticated;

-- Preserve a usable baseline history for existing requests/offers; past status transitions are not inferable.
INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details, created_at)
SELECT r.id, r.customer_id, 'request_posted', jsonb_build_object('targeted', r.target_artisan_id IS NOT NULL, 'status', r.status::text), r.created_at
FROM public.customer_requests r
WHERE NOT EXISTS (
  SELECT 1 FROM public.fixmate_request_events e
  WHERE e.request_id = r.id AND e.event_type = 'request_posted'
);
INSERT INTO public.fixmate_request_events (request_id, actor_id, event_type, details, created_at)
SELECT o.request_id, o.artisan_id, 'offer_sent', jsonb_build_object('status', o.status::text, 'quote_ngn', o.quote_ngn), o.created_at
FROM public.artisan_offers o
WHERE NOT EXISTS (
  SELECT 1 FROM public.fixmate_request_events e
  WHERE e.request_id = o.request_id AND e.event_type = 'offer_sent'
    AND e.actor_id = o.artisan_id AND e.created_at = o.created_at
);
