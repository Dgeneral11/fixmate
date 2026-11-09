# FixMate Connected MVP — TODO

## [x] Google-only authentication and role onboarding
**Acceptance criteria:** Google OAuth is the only sign-in method; no FixMate-specific password, email OTP, or magic-link login is offered. Users choose Customer or Artisan after Google sign-in. Server-side roles, administrator allowlist, and protected dashboard routing remain intact. Keep secrets out of the frontend/repository.

**Evidence:** The previously deployed Google-only auth flow and account-type selection remain intact. Build checks pass. Real sign-in and role routing still require the owner to exercise Google OAuth with a permitted Google account.

## [x] Inclusive customer verification and private evidence
**Acceptance criteria:** Ask customers whether they are students. Students submit a student ID; non-students submit an alternative government-issued ID. NIN is one accepted alternative, not a universal requirement. Retain a profile photo and administrator approval. Store evidence privately and expose it only to its owner and authorized administrators. Do not send ID files through WhatsApp or expose ID numbers on profiles.

**Evidence:** Customer onboarding now has the student/non-student choice and alternate ID options. The additive live migration preserves existing student records, adds scoped field privileges, updates the server-side submission/approval rules, and keeps documents in the private verification bucket. Admin review displays the applicable evidence via short-lived signed links.

## [x] Twelve-hour review expectation and support escalation
**Acceptance criteria:** Customer and artisan pending/in-review screens say review is expected within 12 hours and direct users to contact FixMate support/admin if no update arrives after 12 hours. Keep status labels and more-information requests distinct. Support links open a draft only.

**Evidence:** Both customer and artisan pending/review UI now contains the 12-hour expectation and existing WhatsApp support-draft link.

## [x] Optional customer request reference photos
**Acceptance criteria:** Customers may attach optional JPG/PNG photos when posting direct or matching requests. Requests remain submittable without photos. Restrict reads to the customer, relevant targeted/matching request participants, and authorized administrators. Store files privately and enforce access with RLS and Storage policies.

**Evidence:** Matching and direct request screens accept up to five optional JPG/PNG photos, each up to 8 MB. The live migration created a private media bucket and participant-scoped policies for attachment metadata and objects.

## [x] Optional artisan portfolio photos and concise profiles
**Acceptance criteria:** Artisans may upload optional work/achievement photos separate from private identity/trade documents. Approved customers can view them only on verified active artisan profiles. Profiles show name, short description, genuine ratings/reviews, optional photos, availability, and Request Service; they do not show location details or generic safety copy. Disable requests while unavailable.

**Evidence:** Added a customer-facing artisan profile screen, live review summary/detail RPCs, signed portfolio previews, and an artisan-owned portfolio manager. Customer profile cards no longer show service-zone details.

## [x] Direct artisan request and separate matching path
**Acceptance criteria:** From an available artisan's profile, an approved customer can open a dedicated request screen, see the selected service/artisan, enter title and description, optionally attach photos, and submit with Add Request. A direct request is visible only to its selected artisan and authorized participants/admin. Artisan offers/quotes use the existing accept-and-message flow. Keep the separate category/zone matching process.

**Evidence:** Added direct-request UI and an optional database target artisan. Live request RLS, offer eligibility, and insert rules distinguish targeted from matching requests. Existing customer matching flow remains available.

## [x] Two accepted unfinished jobs maximum per artisan
**Acceptance criteria:** An artisan holds no more than two accepted, unfinished jobs across all categories. Pending offers, completed jobs, and cancelled jobs do not count. Enforce the cap in the database under a per-artisan lock and show the artisan's current count and a clear block reason.

**Evidence:** The live offer-acceptance RPC locks the artisan profile before counting accepted unfinished requests, rejects a third acceptance, and the artisan workspace displays the current `n/2` count. Multiple service categories remain allowed.

## [x] Genuine ratings/reviews on artisan profiles
**Acceptance criteria:** Preserve completed-job-only reviews. Show real average rating, count, and review text from live records only; show an honest empty state before the first review. Do not expose customer contacts.

**Evidence:** Added authenticated-customer-only review summary/detail RPCs that omit reviewer identity and display real data or the no-reviews state.

## [x] Per-user job history and administrator marketplace history
**Acceptance criteria:** Customers and artisans view their own request/offer history with meaningful status transitions, dates, and quotes. Admins inspect marketplace history. Do not record page views or private chat contents. Preserve existing admin audit data.

**Evidence:** Database triggers record request creation/status changes, offers/status changes, and reviews. Customer and artisan task cards show participant-scoped timelines; the admin dashboard has a Job history tab. Existing records were backfilled with request/offer creation events. Earlier status transitions cannot be reconstructed. Four historical event rows were verified after migration.

## [x] Fresh messages and chat status on entry/selection
**Acceptance criteria:** Refresh request/offer statuses and messages when entering Messages, selecting another conversation, and returning to a visible chat. Show refresh errors rather than misreporting an empty conversation.

**Evidence:** Both role dashboards reload their conversation lists on Messages entry; MessagesPanel fetches the current request/offer status and messages on selection/focus and has a manual refresh control.

## [x] Live updates across workspaces
**Acceptance criteria:** Changes to the signed-in user's own requests, offers, messages, reviews, attachments, and application/profile status, plus the artisan availability/profile data, admin review queues, account directory, complaints, marketplace history, and service-zone settings shown to the current role, appear without a manual page refresh. Use authenticated, role-scoped Supabase Realtime subscriptions to insert/update events, filter user/request-specific listeners where possible, retain RLS as the access boundary, batch event bursts, avoid stale/empty flicker, and unsubscribe on role/view changes. Refresh on reconnect and tab return; use low-frequency polling only when Realtime is disconnected. Do not send private message bodies, identity documents, or unrelated account rows through a broad client-side listener.

**Evidence:** Added the shared RLS-scoped Realtime hook, live status indicators, role-specific invalidation for customer/artisan/admin views, request-scoped message listeners, and updates to review/portfolio/photo views. The live Supabase migration `fixmate_realtime_refresh` (`20261107154310`) added 16 existing RLS-protected tables to `supabase_realtime` and profile invalidation triggers. Clients only listen to INSERT/UPDATE and re-query through existing authorized queries; raw reviews and admin-note tables are excluded. The Realtime frontend was published on 8 November 2026 as Netlify deploy `6af014f2f53ca06b16ef13be`; public verification confirmed all 20 deployed files match the local production bundle. Real-account chat and role-flow testing remains pending.

## [x] Errands discovery and distinct category icons
**Acceptance criteria:** Match Errands requests through approved artisan category, availability, profile status, active service zone, and RLS. Distinguish electrical, phone/computer, and errands icons and give an actionable empty state.

**Evidence:** Live request-view/offer functions were verified to use the category, zone, availability, and approval rules; the Errands icon and no-match guidance are distinct. A read-only live check found 0 open Errands requests and 2 verified available Errands artisans, so no existing open Errands job was available for a production end-to-end visibility check.

## [x] Review UI simplification and dashboard access boundaries
**Acceptance criteria:** Reduce repetitive generic copy, simplify customer-facing profiles, preserve essential privacy/security notices, retain separate admin/customer/artisan dashboards, keep admin Customers/Artisans/All accounts, and do not expose all accounts to artisans. Avoid invented fixed prices; preserve real quotes. Keep mobile navigation safe-area support and ensure the Netlify overlay is disabled at the project level.

**Evidence:** Customer and artisan navigation remains role-specific; admin tabs remain Customers, Artisans and All accounts, with Job history added. Customer-facing artisan profiles omit zone details. Existing real quotes remain. The host badge was previously disabled in Netlify project settings; the updated frontend has now been deployed, but visual confirmation on mobile remains part of owner testing.

## [x] Preserve existing data and secure access
**Acceptance criteria:** Continue in the existing Supabase project; use additive migrations; create no production test users, jobs, messages, reviews, complaints, or private evidence. Keep browser-safe Supabase credentials, role-based admin access, existing allowlist members, legacy records, and narrow RLS/Storage policies.

**Evidence:** Applied migration `fixmate_review_corrections` (`20261106082049`) to the existing Supabase project. Verified the new columns/tables, policies, private bucket, security-definer RPCs, narrow column grants, event triggers, and existing migration history. No test records were created.

## [x] Publish the frontend to the existing Netlify site
**Acceptance criteria:** Publish the verified Vite production build to the existing FixMate Netlify site; do not create another site.

**Evidence:** Published the review-corrections build to the existing `fixmate-b5ph` project via Netlify Drop on 7 November 2026 (deploy `6aef41296abd4c9f1785d934`), then published the Realtime build on 8 November 2026 (deploy `6af014f2f53ca06b16ef13be`) and the approved visual refresh (deploy `6af023d2eca57169c785d98e`). The public site returned HTTP 200; all 20 files in the visual-refresh bundle matched the local build byte-for-byte.

## [x] Consistent emerald visual system and restrained motion
**Acceptance criteria:** Keep current FixMate functionality and layout. Use a consistent emerald brand colour, neutral backgrounds, and better spacing. A small, coordinated set of complementary accents may be used for warmth, category recognition, and status hierarchy. Add subtle, purposeful animations. Avoid excessive colours, flashy effects, or animations that slow down the app, and respect reduced-motion preferences.

**Evidence:** Refined shared emerald/neutral tokens, introduced restrained muted blue/gold accents for category hierarchy, improved card/form/dashboard spacing, and added short page-entry and interaction feedback using CSS transforms/opacity. Existing reduced-motion overrides remain in place. `pnpm build` and `git diff --check` pass; the local sign-in preview was visually checked. The approved visual refresh was published to the existing Netlify site as deploy `6af023d2eca57169c785d98e`; all 20 public files match the local build.

## [x] V4-inspired visual redesign and ABU pilot-copy cleanup
**Acceptance criteria:** Keep FixMate as the brand and retain the current public URL, functionality, and role-specific layout. Use the supplied `fixmate-v4.html` as the visual reference so the palette, contrast, and motion are visibly more expressive: dark ink/navy framing, emerald gradient actions, bright cards, cool neutral surfaces, and restrained complementary accents. Add perceptible but brief purposeful transitions/entrances, and respect reduced-motion preferences. Remove general “ABU Main Campus pilot” promotional/admin copy, but keep the existing campus zone names and IDs, service coverage, and matching/database rules exactly unchanged. Keep Google-only sign-in; do not copy the reference's password/OTP screens.

**Evidence:** Implemented a dark navy/emerald sign-in scene, vivid gradient primary actions, richer service/category/status accents, and staggered opacity/transform entrances across app sections and lists. Removed general ABU pilot copy from auth, customer, artisan, admin, and page metadata; left service-zone source data and matching/database rules untouched. The local sign-in preview was visually checked; `pnpm build`, `git diff --check`, and the CSS variable audit pass. The approved v4 build is now live as deploy `6af028caf0e24ba6f4ca77cd`; all 20 files match the local build on both the deploy permalink and stable domain.

## [x] Publish the v4 redesign to the existing Netlify site
**Acceptance criteria:** Publish the verified Vite production build to the existing `fixmate-b5ph` site only; retain the current FixMate URL and do not create another site. Obtain owner approval before the production update.

**Evidence:** Published after explicit owner approval to the existing `fixmate-b5ph` project on 8 November 2026 as deploy `6af028caf0e24ba6f4ca77cd`. The production domain and deploy permalink both returned HTTP 200 for all 20 files, matching the local bundle byte-for-byte; the URL and project were unchanged.

## [ ] Owner end-to-end test
**Acceptance criteria:** Using real permitted accounts, test Google login, student and non-student onboarding, private uploads, direct and matched requests, Errands visibility, the two-job cap and slot release after completion, reviews, role-scoped history, chat refresh, and mobile layout. Do not create production test accounts or jobs.

**Current status:** `pnpm build`, `git diff --check`, the CSS variable audit, and route-manifest JSON check pass. The Realtime migration and v4 redesign are live in deploy `6af028caf0e24ba6f4ca77cd`; source changes remain uncommitted/unpushed to GitHub. Real-account workflows and mobile visual checks still require owner testing.


## Realtime and visual release gate — 8 November 2026
The live Supabase migration is applied: all 16 published FixMate tables retain RLS and a SELECT/ALL policy. The Realtime frontend, v4 redesign, and ABU pilot-copy cleanup are live in deploy `6af028caf0e24ba6f4ca77cd`. Both the deploy permalink and stable production URL served all 20 files byte-for-byte identical to the local build. The v4 release made no database changes. Real-account testing of sign-in, chat/status updates, and the artisan job cap remains pending. Source changes remain uncommitted and unpushed to GitHub.
