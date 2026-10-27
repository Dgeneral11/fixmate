DO $$
BEGIN
  CREATE TYPE public.fixmate_request_status AS ENUM ('open', 'accepted', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.fixmate_offer_status AS ENUM ('pending', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.fixmate_complaint_status AS ENUM ('submitted', 'in_review', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.customer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  service_category public.fixmate_service_category NOT NULL,
  zone_id uuid NOT NULL REFERENCES public.pilot_service_zones(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 100),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 10 AND 2500),
  status public.fixmate_request_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_requests_open_match_idx
  ON public.customer_requests (status, service_category, zone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_requests_customer_idx
  ON public.customer_requests (customer_id, created_at DESC);
ALTER TABLE public.customer_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.artisan_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.customer_requests(id) ON DELETE CASCADE,
  artisan_id uuid NOT NULL REFERENCES public.artisan_profiles(user_id) ON DELETE RESTRICT,
  quote_ngn numeric(12,2) CHECK (quote_ngn IS NULL OR quote_ngn > 0),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 3 AND 1200),
  status public.fixmate_offer_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, artisan_id)
);
CREATE INDEX IF NOT EXISTS artisan_offers_artisan_idx
  ON public.artisan_offers (artisan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artisan_offers_request_idx
  ON public.artisan_offers (request_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS artisan_offers_one_accepted_per_request_idx
  ON public.artisan_offers (request_id) WHERE status = 'accepted'::public.fixmate_offer_status;
ALTER TABLE public.artisan_offers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.request_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.artisan_offers(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_messages_offer_idx
  ON public.request_messages (offer_id, created_at);
ALTER TABLE public.request_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.job_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.customer_requests(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  artisan_id uuid NOT NULL REFERENCES public.artisan_profiles(user_id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review text NOT NULL DEFAULT '' CHECK (char_length(btrim(review)) <= 1500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_reviews_artisan_idx
  ON public.job_reviews (artisan_id, created_at DESC);
ALTER TABLE public.job_reviews ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.customer_requests(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('safety', 'workmanship', 'communication', 'conduct', 'other')),
  details text NOT NULL CHECK (char_length(btrim(details)) BETWEEN 10 AND 2500),
  status public.fixmate_complaint_status NOT NULL DEFAULT 'submitted',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> subject_user_id)
);
CREATE INDEX IF NOT EXISTS user_complaints_admin_queue_idx
  ON public.user_complaints (status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_complaints_reporter_idx
  ON public.user_complaints (reporter_id, created_at DESC);
ALTER TABLE public.user_complaints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.complaint_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.user_complaints(id) ON DELETE CASCADE,
  administrator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.complaint_admin_notes ENABLE ROW LEVEL SECURITY;

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
          OR EXISTS (
            SELECT 1 FROM public.artisan_offers o
            WHERE o.request_id = r.id AND o.artisan_id = p_user_id
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.fixmate_is_offer_participant(p_offer_id uuid, p_user_id uuid)
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
      FROM public.artisan_offers o
      JOIN public.customer_requests r ON r.id = o.request_id
      WHERE o.id = p_offer_id
        AND (r.customer_id = p_user_id OR o.artisan_id = p_user_id)
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
        AND public.fixmate_is_verified_artisan(p_user_id)
        AND r.service_category = ANY(ap.service_categories)
    );
$function$;

CREATE OR REPLACE FUNCTION private.fixmate_is_review_eligible(p_request_id uuid, p_customer_id uuid, p_artisan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_customer_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.customer_requests r
      JOIN public.profiles p ON p.id = p_customer_id
      JOIN public.artisan_offers o ON o.request_id = r.id AND o.artisan_id = p_artisan_id
      WHERE r.id = p_request_id
        AND r.customer_id = p_customer_id
        AND r.status = 'completed'::public.fixmate_request_status
        AND p.role = 'customer'::public.fixmate_role
        AND p.account_status = 'active'::public.fixmate_account_status
        AND o.status = 'accepted'::public.fixmate_offer_status
    );
$function$;

CREATE OR REPLACE FUNCTION private.fixmate_is_complaint_eligible(p_request_id uuid, p_reporter_id uuid, p_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT p_reporter_id = (SELECT auth.uid())
    AND p_reporter_id <> p_subject_id
    AND EXISTS (
      SELECT 1
      FROM public.customer_requests r
      JOIN public.profiles p ON p.id = p_reporter_id
      WHERE r.id = p_request_id
        AND r.status IN ('open'::public.fixmate_request_status, 'accepted'::public.fixmate_request_status, 'completed'::public.fixmate_request_status)
        AND p.account_status = 'active'::public.fixmate_account_status
        AND (
          (r.customer_id = p_reporter_id AND EXISTS (
            SELECT 1 FROM public.artisan_offers o
            WHERE o.request_id = r.id AND o.artisan_id = p_subject_id
          ))
          OR
          (r.customer_id = p_subject_id AND EXISTS (
            SELECT 1 FROM public.artisan_offers o
            WHERE o.request_id = r.id AND o.artisan_id = p_reporter_id
          ))
        )
    );
$function$;

REVOKE ALL ON FUNCTION private.fixmate_can_view_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_is_request_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_is_offer_participant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_can_offer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_is_review_eligible(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.fixmate_is_complaint_eligible(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_can_view_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_is_request_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_is_offer_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_can_offer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_is_review_eligible(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.fixmate_is_complaint_eligible(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS customer_requests_read_participants_or_matching_artisan ON public.customer_requests;
CREATE POLICY customer_requests_read_participants_or_matching_artisan
  ON public.customer_requests FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR private.fixmate_can_view_request(id, (SELECT auth.uid()))
  );
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
  );
REVOKE ALL ON TABLE public.customer_requests FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.customer_requests TO authenticated;

DROP POLICY IF EXISTS artisan_offers_read_participants_or_admin ON public.artisan_offers;
CREATE POLICY artisan_offers_read_participants_or_admin
  ON public.artisan_offers FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR (
      private.fixmate_profile_is_active((SELECT auth.uid()))
      AND private.fixmate_is_request_participant(request_id, (SELECT auth.uid()))
    )
  );
DROP POLICY IF EXISTS artisan_offers_insert_verified_artisan ON public.artisan_offers;
CREATE POLICY artisan_offers_insert_verified_artisan
  ON public.artisan_offers FOR INSERT TO authenticated
  WITH CHECK (
    artisan_id = (SELECT auth.uid())
    AND status = 'pending'::public.fixmate_offer_status
    AND private.fixmate_can_offer(request_id, (SELECT auth.uid()))
  );
REVOKE ALL ON TABLE public.artisan_offers FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.artisan_offers TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_guard_artisan_offer_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status public.fixmate_request_status;
BEGIN
  IF auth.uid() IS NULL OR new.artisan_id <> (SELECT auth.uid())
    OR new.status <> 'pending'::public.fixmate_offer_status THEN
    RAISE EXCEPTION 'Only the current artisan may submit a pending offer' USING errcode = '42501';
  END IF;
  SELECT status INTO v_status
  FROM public.customer_requests WHERE id = new.request_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'open'::public.fixmate_request_status
    OR NOT private.fixmate_can_offer(new.request_id, new.artisan_id) THEN
    RAISE EXCEPTION 'This request is no longer available to this artisan' USING errcode = '42501';
  END IF;
  RETURN new;
END;
$function$;
DROP TRIGGER IF EXISTS artisan_offer_insert_guard ON public.artisan_offers;
CREATE TRIGGER artisan_offer_insert_guard
  BEFORE INSERT ON public.artisan_offers
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_guard_artisan_offer_insert();

DROP POLICY IF EXISTS request_messages_read_participants ON public.request_messages;
CREATE POLICY request_messages_read_participants
  ON public.request_messages FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR (
      private.fixmate_profile_is_active((SELECT auth.uid()))
      AND private.fixmate_is_offer_participant(offer_id, (SELECT auth.uid()))
    )
  );
DROP POLICY IF EXISTS request_messages_insert_participants ON public.request_messages;
CREATE POLICY request_messages_insert_participants
  ON public.request_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND private.fixmate_profile_is_active((SELECT auth.uid()))
    AND private.fixmate_is_offer_participant(offer_id, (SELECT auth.uid()))
  );
REVOKE ALL ON TABLE public.request_messages FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.request_messages TO authenticated;

DROP POLICY IF EXISTS job_reviews_read_participants_or_admin ON public.job_reviews;
CREATE POLICY job_reviews_read_participants_or_admin
  ON public.job_reviews FOR SELECT TO authenticated
  USING (
    public.fixmate_has_role('administrator'::public.fixmate_role)
    OR customer_id = (SELECT auth.uid())
    OR artisan_id = (SELECT auth.uid())
  );
DROP POLICY IF EXISTS job_reviews_insert_completed_job_customer ON public.job_reviews;
CREATE POLICY job_reviews_insert_completed_job_customer
  ON public.job_reviews FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = (SELECT auth.uid())
    AND private.fixmate_is_review_eligible(request_id, customer_id, artisan_id)
  );
REVOKE ALL ON TABLE public.job_reviews FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.job_reviews TO authenticated;

DROP POLICY IF EXISTS user_complaints_read_reporter_or_admin ON public.user_complaints;
CREATE POLICY user_complaints_read_reporter_or_admin
  ON public.user_complaints FOR SELECT TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role) OR reporter_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_complaints_insert_request_participant ON public.user_complaints;
CREATE POLICY user_complaints_insert_request_participant
  ON public.user_complaints FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND status = 'submitted'::public.fixmate_complaint_status
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND private.fixmate_is_complaint_eligible(request_id, reporter_id, subject_user_id)
  );
REVOKE ALL ON TABLE public.user_complaints FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.user_complaints TO authenticated;

DROP POLICY IF EXISTS complaint_admin_notes_read_admin ON public.complaint_admin_notes;
CREATE POLICY complaint_admin_notes_read_admin
  ON public.complaint_admin_notes FOR SELECT TO authenticated
  USING (public.fixmate_has_role('administrator'::public.fixmate_role));
REVOKE ALL ON TABLE public.complaint_admin_notes FROM anon, authenticated;
GRANT SELECT ON TABLE public.complaint_admin_notes TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_touch_marketplace_updated_at()
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
DROP TRIGGER IF EXISTS customer_requests_touch_updated_at ON public.customer_requests;
CREATE TRIGGER customer_requests_touch_updated_at
  BEFORE UPDATE ON public.customer_requests
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_touch_marketplace_updated_at();
DROP TRIGGER IF EXISTS artisan_offers_touch_updated_at ON public.artisan_offers;
CREATE TRIGGER artisan_offers_touch_updated_at
  BEFORE UPDATE ON public.artisan_offers
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_touch_marketplace_updated_at();
DROP TRIGGER IF EXISTS user_complaints_touch_updated_at ON public.user_complaints;
CREATE TRIGGER user_complaints_touch_updated_at
  BEFORE UPDATE ON public.user_complaints
  FOR EACH ROW EXECUTE FUNCTION public.fixmate_touch_marketplace_updated_at();

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

CREATE OR REPLACE FUNCTION public.fixmate_customer_cancel_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.fixmate_has_role('customer'::public.fixmate_role)
    OR NOT private.fixmate_profile_is_active((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'An approved customer account is required' USING errcode = '42501';
  END IF;
  UPDATE public.customer_requests
  SET status = 'cancelled'::public.fixmate_request_status, updated_at = now()
  WHERE id = p_request_id
    AND customer_id = (SELECT auth.uid())
    AND status = 'open'::public.fixmate_request_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an open request owned by this customer can be cancelled'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_customer_cancel_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_customer_cancel_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_complete_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_customer_id uuid;
  v_status public.fixmate_request_status;
  v_allowed boolean := false;
BEGIN
  IF NOT private.fixmate_profile_is_active((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'An approved account is required' USING errcode = '42501';
  END IF;
  SELECT customer_id, status INTO v_customer_id, v_status
  FROM public.customer_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'accepted'::public.fixmate_request_status THEN
    RAISE EXCEPTION 'Only an accepted request can be marked complete';
  END IF;
  IF public.fixmate_has_role('customer'::public.fixmate_role) AND v_customer_id = (SELECT auth.uid()) THEN
    v_allowed := true;
  ELSIF public.fixmate_has_role('artisan'::public.fixmate_role) AND EXISTS (
    SELECT 1 FROM public.artisan_offers o
    WHERE o.request_id = p_request_id
      AND o.artisan_id = (SELECT auth.uid())
      AND o.status = 'accepted'::public.fixmate_offer_status
  ) THEN
    v_allowed := true;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Only the customer or accepted artisan may complete this request' USING errcode = '42501'; END IF;
  UPDATE public.customer_requests
  SET status = 'completed'::public.fixmate_request_status, updated_at = now()
  WHERE id = p_request_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_complete_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_complete_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_submit_complaint_review(p_complaint_id uuid, p_status public.fixmate_complaint_status, p_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.fixmate_has_role('administrator'::public.fixmate_role) THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode = '42501';
  END IF;
  IF p_status NOT IN ('in_review'::public.fixmate_complaint_status, 'resolved'::public.fixmate_complaint_status, 'dismissed'::public.fixmate_complaint_status) THEN
    RAISE EXCEPTION 'Invalid complaint review state';
  END IF;
  UPDATE public.user_complaints
  SET status = p_status, reviewed_by = (SELECT auth.uid()), reviewed_at = now(), updated_at = now()
  WHERE id = p_complaint_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complaint not found'; END IF;
  IF btrim(coalesce(p_note, '')) <> '' THEN
    INSERT INTO public.complaint_admin_notes (complaint_id, administrator_id, note)
    VALUES (p_complaint_id, (SELECT auth.uid()), left(p_note, 2000));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_submit_complaint_review(uuid, public.fixmate_complaint_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_submit_complaint_review(uuid, public.fixmate_complaint_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fixmate_artisan_review_summary(p_artisan_id uuid)
RETURNS TABLE (review_count bigint, average_rating numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT private.fixmate_profile_is_active((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'An approved account is required' USING errcode = '42501';
  END IF;
  IF NOT public.fixmate_is_verified_artisan(p_artisan_id) THEN
    RETURN QUERY SELECT 0::bigint, NULL::numeric;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT count(*)::bigint, round(avg(r.rating)::numeric, 1)
  FROM public.job_reviews r
  WHERE r.artisan_id = p_artisan_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fixmate_artisan_review_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fixmate_artisan_review_summary(uuid) TO authenticated;
