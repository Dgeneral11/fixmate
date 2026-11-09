# FixMate — Connected MVP Plan

## Approved scope and implementation

Continue the existing mobile-first FixMate application in React, TypeScript, and Vite, backed by the existing Supabase project and hosted on the existing Netlify site when separately authorized. The connected app—not the standalone HTML prototype—handles Google sign-in, private uploads, approvals, marketplace actions, and administrator operations.

Google OAuth is the sole sign-in method. Do not add FixMate passwords, email OTP, or magic-link login. The browser may use only the Supabase project URL and publishable key. Never add a service-role key, OAuth client secret, or privileged database operation to frontend code. Enforce role, ownership, approval, workload limits, and private-file access in PostgreSQL RLS, database functions/triggers, and private Storage policies. Frontend role checks are for navigation only and are not authorization.

All types of customers and artisans may register, including students, tenants, shop/business owners, and other residents. The service footprint remains ABU Main Campus for this pilot; the brand is FixMate, not FixMate ABU. Customer and artisan access remains gated by the appropriate administrator review. Keep WhatsApp contact details private to the owner and authorized administrators; WhatsApp is not a login method.

## Customer verification and review communication

During customer onboarding, ask whether the person is a student. A student submits a student ID; a non-student submits an alternative government-issued ID. NIN is one accepted alternative when the user chooses it, not a universal requirement. Do not ask users to type an ID number into a public profile or place documents in chat. Keep submitted IDs and profile photos in private Storage and show them only to the owner and authorized administrators. Preserve the existing customer-review/administrator-approval gate.

Both customer and artisan pending/in-review screens state that review is expected within 12 hours and that the user can contact FixMate support/admin if there is no update after 12 hours. The support link opens a WhatsApp draft; it does not send a message automatically. Status labels should clearly distinguish submitted/pending, under review, more information needed, approved, rejected, and other existing supported states.

## Pilot services and service zones

The service pilot is ABU Main Campus only. Do not include off-campus locations, surrounding communities, or Kongo Campus in service selectors or matching rules. Use only these three approved categories: **Electrical repairs**, **Phone and computer repair**, and **Errands**. Preserve the migrated category identifier `phone_computer_repair`.

Use the existing grouped 30-zone list and active-zone configuration:

- **Student halls and hostels:** Akenzua Hall; Amina Hall; Alexander Hall; Danfodio Hall; ICSA Hall; Ramat Hall; Ribadu Hall; Suleiman Hall; Shehu Idris Hall; Aliko Dangote Hall.
- **Gates and access points:** ABU North Gate; ABU Main Gate; Phase II / Site II entrance.
- **Markets and commercial centres:** ABU Community Market; Samaru Market-side campus access; Community Market Junction; Hall shopping complexes and minimarkets; North Gate shops and business area; Main Gate commercial area; Campus kiosks and food vendors area.
- **Student service centres and landmarks:** Aliyu Mustapha Social Centre; Pharmacy Roundabout; Kashim Ibrahim Library area; ABU Bookshop; Central Mosque / Main Gate area; ABU Post Office area; Senate Building area; Students' clinic / campus medical centre; Faculty of Engineering area; Postgraduate School / postgraduate accommodation area.

These are proposed service zones and landmarks, not independently verified map pins. Store no coordinates and make no claim of map verification. Customers choose a zone for a request. Artisans can choose multiple zones and multiple approved service categories. Do not limit the number of service categories to two.

## Product flows and data boundaries

- **Customer:** Google authentication and one-time account-type selection. Complete customer verification with a profile photo plus the right ID for student/non-student status; retain private administrator approval. Once approved, manage requests, offers, messages, reviews, and personal job history. Customers may either (a) select an available artisan and submit a direct request visible only to that artisan or (b) post through the existing category/zone matching process for eligible artisans. In a direct request, the selected artisan may respond with a quote; the customer accepts an offer to confirm work, as in the existing marketplace flow.
- **Artisan:** Google authentication, private WhatsApp contact, profile, multiple approved service categories, and one or more ABU Main Campus zones. Submit required evidence for review; only a verified active artisan may receive marketplace requests. Show a concise customer-facing profile with name, short description, genuine rating/review history, optional work photos, availability, and a Request Service CTA. Do not show the artisan's location details or bulky safety/explanatory text on that profile. Disable the CTA while unavailable. Keep trade/identity qualifications in private administrator-review storage; optional portfolio photos are distinct from confidential evidence.
- **Workload limit:** Enforce a hard cap of two accepted, unfinished jobs per artisan across all categories. An accepted request counts until completed or cancelled; pending offers do not count. Enforce the cap in the offer-acceptance RPC while serializing acceptance per artisan, so concurrent acceptances cannot bypass the limit. The cap is not a two-category or two-listing limit.
- **Administrator:** Keep the role-protected dashboard and existing server-side allowlist/role assignment. Preserve administrator review of customer and artisan submissions, all-account directory, account controls, complaints, and zone settings. Use existing review/action records for meaningful administrator history; do not expose private ID documents outside admin review.
- **Optional media:** Customer request reference images are optional and visible only to the customer, relevant selected/matching request participants, and authorized administrators. Artisan portfolio/work photos are optional profile media, visible to approved customers and administrators when the artisan is verified; identity documents and qualification evidence remain private. Use private Storage with narrowly scoped policies and signed URLs as appropriate.
- **History and audit:** Keep a per-request event timeline for meaningful marketplace activity such as request creation, offers, offer acceptance/decline, cancellation, completion, and review. Customers and artisans may see history only for their own jobs and requests; admins may inspect meaningful audit records. Do not record page views or private chat contents as activity events. Existing admin action/review notes remain admin-only.
- **Pricing:** Do not invent fixed prices. Keep real artisan quotes until the owner provides the content/rates for a fixed-price bar.
- **Chat refresh:** Refresh conversations and messages when a user enters the Messages section and when changing the selected conversation so stale information is not shown.
- **Realtime refresh:** Use Supabase Postgres Changes for inserts and updates in the existing tables that drive each signed-in view. Enable only the needed tables in `supabase_realtime`, retain RLS/ownership checks, filter user-specific subscriptions where possible, debounce bursts into background reloads, and unsubscribe when a user or view changes. Refresh after reconnect and tab return, with a slow fallback only while Realtime is disconnected. Keep message, request-photo, artisan-profile, review, verification, and admin views fresh without putting private message/evidence content into client-side event state.

## Marketplace data model and authorization

Use the existing `customer_requests`, `artisan_offers`, `request_messages`, `job_reviews`, and complaint tables/RPCs. Add an optional target artisan to direct requests and retain separate matching behavior. RLS must permit an artisan to see a targeted request only when selected; unmatched requests remain visible only to verified active artisans whose approved category and active zone match. Offers, messages, attachments, event timelines, reviews, and complaints remain scoped to the correct participants and administrator role. Lock the artisan row while counting accepted unfinished requests in the acceptance RPC. Preserve existing rows and use additive migrations.

Review and fix the Errands visibility path by checking category, availability, approved profile, active zone, and request RLS together. Use distinct category icons for electrical repairs, phone/computer repair, and errands. Keep customer WhatsApp numbers, ID documents, private messages, and admin notes outside public profile/request data.

## Design direction

- **Design movement:** Follow the supplied `fixmate-v4.html` reference: a bold, mobile-first service marketplace with dark ink/navy framing, confident emerald action surfaces, bright white cards, and cool cloud backgrounds. Apply its visual language to the existing responsive role dashboards rather than wrapping every page in a phone mockup.
- **Core principles:** Make the redesign immediately perceptible; keep service and account states easy to scan; use color to guide decisions; retain the practical, trustworthy FixMate identity.
- **Color philosophy:** Use FixMate emerald `#00875A` and glow `#00C47A` for brand/action emphasis; ink `#1A1A2E` and slate `#2E3A59` for framing and strong text; cloud `#F4F6FB` and white for readable content surfaces. Use amber, blue, and red sparingly for meaningful category/status distinction, not as decoration. Maintain accessible text contrast.
- **Layout paradigm:** Preserve existing routes, workspace structures, and role-specific navigation. Keep mobile-first stacked content and bottom navigation; use richer surfaces, clearer section groupings, and stronger contrast without hiding controls or changing workflows.
- **Signature elements:** Deep ink/navy navigation framing; vivid emerald gradient for primary actions and active selection; distinct amber/blue/emerald service-category icon tiles.
- **Interaction philosophy:** Provide clear hover, pressed, focus, selected, and loading feedback with touch-friendly targets. Keep status, error, and empty states truthful and legible.
- **Animation:** Make short page/section entrances and list-item reveals perceptible through opacity and small translate/scale changes, with a restrained stagger for a few initial items. Use 180–360 ms interactions; avoid continuous decorative motion and expensive filters. Honor `prefers-reduced-motion`.
- **Typography system:** Continue Inter/system sans-serif; use bold, compact headings, clear body copy, and concise uppercase metadata labels.
- **Brand essence:** FixMate helps local customers find vetted artisans and services; dependable, direct, welcoming.
- **Brand voice:** Plain, useful, and privacy-conscious. Example lines: “Find trusted local help.” “Choose a service area.”
- **Wordmark & logo:** Keep the existing FixMate wrench mark and wordmark; do not rebrand to ABU Marketplace.
- **Signature brand color:** FixMate emerald `#00875A`.
- **Copy and scope:** Remove general “ABU Main Campus pilot” promotional copy from the interface. Keep actual campus service-zone names/IDs, current coverage, and matching rules unchanged. The existing FixMate site URL and Google-only sign-in also remain unchanged; do not copy the reference's obsolete password/OTP flows.

## Existing administrator and security requirements

Administrator access depends on the securely assigned database role and existing server-side allowlist—not frontend email checks. Preserve the existing allowlisted administrator(s), including `usmanabdul2007@gmail.com`, and any approved teammate entries. Preserve all existing dashboards and project data. Store FixMate's designated WhatsApp support contact in administrator settings; support links open a draft only.

The legacy license table is retained for historical compatibility only. Remove any client-facing access and status-sync behavior as already planned; do not drop data or imply FixMate issues government licenses. Never put private evidence in WhatsApp links, public paths, or seeded data. Do not create production test users, jobs, messages, reviews, complaints, or evidence records.

## Project structure and delivery workflow

Continue the existing repository and Supabase project; do not initialize a second database or hosting site. Keep TypeScript diagnostics and the production Vite build green. Read the live database schema and policies before authoring migrations. Implement the approved changes in source and additive, versioned SQL migrations; validate locally and run a read-only policy check after applying approved migrations. Use only the existing Netlify deployment when the user separately asks to publish; do not push a change that would trigger an unapproved production deploy. End-to-end flows that require personal accounts/documents are tested by the owner unless separately authorized.
