# FixMate Supabase inspection and implementation state

## Existing project

Source: Supabase MCP `list_projects`, `get_project`, `get_project_url`, `list_tables`, `list_migrations`, `get_advisors`, and read-only SQL queries, 2026-10-27. Project `fixmate` is active/healthy, region `eu-west-2`, project ref `hvvbrychsklbwcwcmxwv`, URL `https://hvvbrychsklbwcwcmxwv.supabase.co`.

## Existing schema and security before MVP changes

The existing public tables were `fixmate_admin_allowlist`, `profiles`, `artisan_profiles`, `artisan_verification_applications`, `artisan_verification_checks`, `artisan_verification_documents`, `artisan_verification_admin_notes`, and `artisan_licenses`. RLS was enabled on all. The admin allowlist has one enabled entry matching the address supplied by the user. Profile, artisan, verification, and license tables had zero rows; the allowlist had one row. No customer request, offer, message, review, complaint, or customer-verification table existed.

The existing service-category enum labels were `electrical_repairs`, `computer_services`, and `errands`. The existing private Storage bucket is `fixmate-verification`; confirmed settings: `public=false`, maximum object size `20,971,520` bytes, accepted MIME types `application/pdf`, `image/jpeg`, and `image/png`. The app should enforce a lower client-side per-file cap and use only these types.

`public.fixmate_has_role()` delegates to a private security-definer role helper. An `auth.users` trigger creates profiles; it assigns `administrator` only when the email is allowlisted, enabled, and confirmed, otherwise honors `requested_role='artisan'` on signup or defaults to `customer`. RLS policies call the database role helper. Authenticated users cannot update profile roles or account state directly. Profiles have RLS allowing private self/admin access; the administrator can search profiles. No service-role key was read or copied.

## Supabase Auth provider state

On 2026-10-27 the public Supabase Auth settings endpoint (`https://hvvbrychsklbwcwcmxwv.supabase.co/auth/v1/settings`, called with the publishable key in the request header; key not recorded) reported email enabled and Google disabled. Implement email one-time-code authentication. Do not offer working Google OAuth until the owner enables/configures that provider; the frontend must say it is unavailable rather than simulate it.

## FixMate migration and configuration applied on 2026-10-27

The additive `fixmate_mvp_core` migration applied successfully through Supabase MCP. It added private customer verification submissions and administrator-only notes, pending/active/rejected/restricted account states, role/contact safeguards, customer profile-photo and ABU student-ID Storage policies, grouped Main Campus service zones, and an administrator contact setting. It renamed the existing `computer_services` enum label to `phone_computer_repair`. It removed client API policies on the legacy `artisan_licenses` table and removed the license status-sync trigger; it preserved the table and rows. Do not re-enable FixMate licensing.

Configuration seeding is verified: `public.pilot_service_zones` contains exactly the requested 30 active ABU Main Campus zone names in order; `public.fixmate_contact_settings` contains one row with support WhatsApp `08144196124`. No user, artisan, verification-document, request, offer, message, review, or complaint records were created. The existing license table remains empty.

## Existing artisan verification contract

Artisan verification routes are `trade_credential` and `alternative_assessment`. Application statuses are `draft`, `submitted`, `in_review`, `needs_more_info`, `approved`, `rejected`, `suspended`, `revoked`. Document types are `identity_document`, `trade_credential`, `safety_evidence`, `assessment_evidence`, `in_person_evidence`. Checks are `identity`, `safety`, `trade_credential`, `alternative_assessment`, `in_person`; checks begin `pending`. The database guard requires identity and safety checks to pass, plus the selected trade-credential or alternative-assessment check, before artisan approval. An existing insert trigger seeds the pending checks. Admin-only RLS permits review/check updates; artisans may submit their own drafts and upload evidence to the private bucket. The MVP must never create a license when approving verification.

The administrator login identity is securely sourced from the allowlist (`usmanabdul2007@gmail.com`); frontend email checks are not authorization. The new contact setting is deliberately public for support links, but each user's WhatsApp number remains in private `profiles.phone` and visible only to that user and authorized administrators.

## Official Supabase guidance previously consulted

- Supabase Auth: https://supabase.com/docs/guides/auth — email OTP/magic-link sign-in and session handling.
- Supabase secure-data: https://supabase.com/docs/guides/database/secure-data — browser apps should use publishable keys with RLS; service-role/secret keys bypass RLS and must never be exposed in browser code.
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security — policies are the enforcement layer; frontend checks alone do not authorize data access.

No API secret, service-role key, or customer evidence is recorded in this note.

## Marketplace, access-hardening, and live post-migration state

Source: Supabase MCP `list_migrations`, `execute_sql`, and `get_advisors`, 2026-10-27. Applied migrations now include `fixmate_mvp_core`, `fixmate_marketplace`, `fixmate_restore_availability`, `fixmate_artisan_profile_init`, and `fixmate_access_and_index_hardening` (database versions through `20261027085252`). Live public tables include `customer_requests`, `artisan_offers`, `request_messages`, `job_reviews`, `user_complaints`, `complaint_admin_notes`, `customer_verification_submissions`, `customer_verification_admin_notes`, `pilot_service_zones`, `artisan_service_zones`, `fixmate_account_actions`, and `fixmate_contact_settings`, alongside the original schema.

Verified RPC signatures include: `fixmate_set_initial_role(p_role text)`, `fixmate_admin_review_customer_submission(p_submission_id uuid, p_status fixmate_customer_review_status, p_note text)`, `fixmate_admin_set_account_status(p_user_id uuid, p_new_status fixmate_account_status, p_reason text)`, `fixmate_admin_restore_account(p_user_id uuid, p_reason text)`, `fixmate_customer_respond_to_offer(p_offer_id uuid, p_accept boolean)`, `fixmate_customer_cancel_request(p_request_id uuid)`, `fixmate_complete_request(p_request_id uuid)`, and `fixmate_submit_complaint_review(p_complaint_id uuid, p_status fixmate_complaint_status, p_note text)`.

Migration `fixmate_access_and_index_hardening` revoked direct `anon`/`authenticated` EXECUTE on trigger-only security-definer helpers and the unused artisan-review-summary helper, removed the redundant broad customer-verification policy while retaining the narrower owner/admin read policy and guarded admin review RPC, and added indexes for the 12 foreign keys identified by the advisor. A read-only verification confirmed intended helpers are not directly callable, the application RPCs remain callable by authenticated sessions, the customer review policy set remains, and all added indexes exist.

Post-hardening Supabase security advisor findings: the `artisan_licenses` table has RLS enabled and intentionally no policies (its data remains preserved and inaccessible through the client API); eight signed-in security-definer RPC warnings remain for the intentional app RPCs above, whose functions enforce role/ownership checks; the direct trigger-function exposure warnings were cleared. The performance advisor's 12 unindexed-FK findings were cleared. It still reports 33 unused indexes because the pilot tables are new/empty (do not drop these solely on that basis) and one duplicate SELECT-policy warning on `pilot_service_zones` due to the active-zone read and admin-manage policies; this is a performance note, not an access-control bypass. Remediation references: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy, https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable, https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index, https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies.
