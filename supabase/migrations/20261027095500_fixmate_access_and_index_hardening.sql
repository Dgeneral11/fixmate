-- Tighten the exposed API surface without changing the guarded FixMate RPCs
-- used by signed-in customers, artisans, and administrators.
REVOKE EXECUTE ON FUNCTION public.fixmate_guard_artisan_offer_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_guard_customer_submission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_mark_artisan_profile_pending() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_mark_artisan_zone_change_pending() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_require_artisan_profile_before_review() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_sync_artisan_account_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_touch_contact_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fixmate_touch_marketplace_updated_at() FROM PUBLIC, anon, authenticated;

-- This summary helper is not used by the client MVP; keep it off the REST API.
REVOKE EXECUTE ON FUNCTION public.fixmate_artisan_review_summary(uuid) FROM PUBLIC, anon, authenticated;

-- Administrator customer decisions go through the guarded SECURITY DEFINER RPC;
-- administrators already retain queue SELECT access through the narrower read policy.
DROP POLICY IF EXISTS customer_verification_admin_all ON public.customer_verification_submissions;

-- Cover foreign-key lookup and delete/update paths flagged by the live database advisor.
CREATE INDEX IF NOT EXISTS artisan_service_zones_zone_id_idx
  ON public.artisan_service_zones (zone_id);
CREATE INDEX IF NOT EXISTS complaint_admin_notes_complaint_id_idx
  ON public.complaint_admin_notes (complaint_id);
CREATE INDEX IF NOT EXISTS complaint_admin_notes_administrator_id_idx
  ON public.complaint_admin_notes (administrator_id);
CREATE INDEX IF NOT EXISTS customer_requests_zone_id_idx
  ON public.customer_requests (zone_id);
CREATE INDEX IF NOT EXISTS customer_verification_admin_notes_submission_id_idx
  ON public.customer_verification_admin_notes (submission_id);
CREATE INDEX IF NOT EXISTS customer_verification_admin_notes_administrator_id_idx
  ON public.customer_verification_admin_notes (administrator_id);
CREATE INDEX IF NOT EXISTS fixmate_account_actions_administrator_id_idx
  ON public.fixmate_account_actions (administrator_id);
CREATE INDEX IF NOT EXISTS job_reviews_customer_id_idx
  ON public.job_reviews (customer_id);
CREATE INDEX IF NOT EXISTS request_messages_sender_id_idx
  ON public.request_messages (sender_id);
CREATE INDEX IF NOT EXISTS user_complaints_request_id_idx
  ON public.user_complaints (request_id);
CREATE INDEX IF NOT EXISTS user_complaints_reviewed_by_idx
  ON public.user_complaints (reviewed_by);
CREATE INDEX IF NOT EXISTS user_complaints_subject_user_id_idx
  ON public.user_complaints (subject_user_id);
