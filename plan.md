# FixMate — Connected MVP Plan

## Approved scope and implementation

Build the actual mobile-first FixMate web application in this initialized WebDev workspace, continuing from `fixmate-mvp-preview.html` rather than redesigning it. Use React, TypeScript, Vite, and the existing Supabase project. The hosted app, not the standalone HTML file, will perform authentication, uploads, account approval, marketplace actions, and administrator operations. The standalone file remains a visual reference.

Use the existing Supabase project only. The browser receives only the Supabase project URL and publishable key. Do not add a service-role key or privileged database operation to browser code. Enforce ownership, approval state, administrator roles, and private-document access with PostgreSQL RLS, database functions/triggers, and private Storage policies. Frontend role checks are for navigation only and are not authorization.

Use Supabase email one-time codes and Google sign-in only when the provider is enabled. The existing Auth settings currently report email enabled and Google disabled, so implement email OTP now and show Google sign-in as unavailable until the provider is configured. WhatsApp numbers are contact details, not login credentials. Show actual provider errors; do not simulate authentication.

After email/Google verification, customers submit a profile photo and ABU student ID to private Storage before the administrator reviews the account. Their account remains pending and the marketplace is unavailable until an administrator approves it. NIN and date of birth are not requested by this flow. Artisans supply a WhatsApp contact, profile, service categories, and campus service zones, then submit the profile and relevant verification evidence for administrator review. Only an approved artisan may be marked FixMate-verified or access verified-provider features. Administrators can approve, reject, request more information, restrict, or restore any customer or artisan account; FixMate verification is a separate artisan status.

Store each user’s WhatsApp contact privately and expose it only to that account and authorized administrators. The admin directory supports search by name, email, and WhatsApp number. Store FixMate’s designated support contact `08144196124` in administrator settings/profile for reference and link to WhatsApp using `https://wa.me/2348144196124`. Do not send messages automatically. Do not ask users to send student IDs or other private evidence over WhatsApp.

## Pilot services and service zones

The pilot is **ABU Main Campus only**. Do not include off-campus locations, surrounding communities, or Kongo Campus in selectors or availability rules. Use these three service categories only: **Electrical repairs**, **Phone and computer repair**, and **Errands**. Rename the existing `computer_services` database enum value to `phone_computer_repair` rather than introducing a second computer category.

Create a selectable, grouped list of the 30 proposed service zones below. These are zone names and landmarks, not independently verified map pins; store no coordinates or claim map verification. Customers select one zone for a request. Artisans select one or more zones in which they provide services. Administrators may manage zone availability within this Main Campus pilot.

- **Student halls and hostels:** Akenzua Hall; Amina Hall; Alexander Hall; Danfodio Hall; ICSA Hall; Ramat Hall; Ribadu Hall; Suleiman Hall; Shehu Idris Hall; Aliko Dangote Hall.
- **Gates and access points:** ABU North Gate; ABU Main Gate; Phase II / Site II entrance.
- **Markets and commercial centres:** ABU Community Market; Samaru Market-side campus access; Community Market Junction; Hall shopping complexes and minimarkets; North Gate shops and business area; Main Gate commercial area; Campus kiosks and food vendors area.
- **Student service centres and landmarks:** Aliyu Mustapha Social Centre; Pharmacy Roundabout; Kashim Ibrahim Library area; ABU Bookshop; Central Mosque / Main Gate area; ABU Post Office area; Senate Building area; Students' clinic / campus medical centre; Faculty of Engineering area; Postgraduate School / postgraduate accommodation area.

## Product flows and data boundaries

- **Customer:** email-code/Google onboarding; collect the required WhatsApp contact; after authentication, require a profile photo and ABU student ID submission to private Storage; show pending administrator review and block marketplace use until approval. Once approved, customers can select an ABU Main Campus service zone, create and manage service requests, review artisan offers, message participants, and submit a review only for an eligible completed job.
- **Artisan:** account signup and WhatsApp contact; manage profile, only the three pilot service categories, and one or more of the 30 service zones; submit profile and relevant evidence for administrator review; remain pending until approval; after approval, manage matching service requests and offers/messages. FixMate verification is never presented as a government licence.
- **Administrator:** protected dashboard accessible only to the securely assigned administrator role (existing allowlist entry for `usmanabdul2007@gmail.com` is verified by the database; never trust frontend email alone). Search accounts by name, email, and WhatsApp; privately review customer and artisan submissions; approve, reject, request more information, restrict, and restore; manage complaints; record decisions; revoke FixMate's internal artisan-verified status when appropriate. The admin profile shows the designated WhatsApp contact number.
- **Private evidence:** use the existing private `fixmate-verification` bucket and extend its Storage policies for customer photo/student-ID files. Owners may upload/view their own pending submission as allowed by RLS; only authorized administrators may review evidence. Do not show documents on public profiles, put them in message links, or seed/upload test documents.
- **Legacy license schema:** the current `artisan_licenses` table has client API policies that permit administrator writes, so remove its client-facing read/write policies and its verification-status sync trigger. Preserve the table and any rows; do not use it to issue anything or present it as a government credential. Any independently confirmed official trade credential, if supported, is a separate external record/display from FixMate verification; FixMate does not issue licences.
- **Truthful states:** no fabricated people, counts, ratings, messages, requests, decisions, or live auth claims. New service-zone rows are the only seed data. Do not create user accounts or marketplace test records in the live project. Do not publish the application without a separate user request.

## Marketplace data model and authorization

Use `customer_requests` for a customer's chosen pilot category and one active campus zone; match open requests to artisans only when the artisan is active, FixMate-verified, and has both the selected category and zone. Use `artisan_offers` for artisan responses, `request_messages` for participant-only conversations, `job_reviews` for reviews tied to completed requests and accepted offers, and `user_complaints` plus administrator-only notes for safety/quality issues. Enforce request, offer, message, review, and complaint ownership and active-account rules in PostgreSQL RLS and narrow status-transition RPCs. Keep WhatsApp numbers and verification documents outside the public marketplace records. No payment, escrow, licence, fabricated listing, or test-account behavior is part of this MVP.

## Design direction

- **Design Movement:** continue the supplied FixMate v4 reference and approved HTML prototype's mobile marketplace presentation.
- **Core Principles:** familiar FixMate visual language; clear role-specific flows; emerald as a restrained trust/action cue; privacy and review status are always explicit.
- **Color Philosophy:** keep emerald `#00875A`, dark green `#006644`, and pale green `#E3F5EE` for primary actions and trust states, with the existing navy, slate, white, and cloud surfaces. Amber/red remain reserved for caution and restriction states.
- **Layout Paradigm:** handset-first stacked screens with thumb-friendly bottom navigation. Public screens never expose an Admin tab; navigation follows the authenticated role. Administrator tools use a compact private dashboard.
- **Signature Elements:** FixMate wrench mark; emerald primary-action gradient; rounded cards and concise status pills from the existing reference.
- **Interaction Philosophy:** fast direct transitions with real Supabase operations; clear loading, validation, pending, error, and empty states. Never show local placeholder data as saved server data.
- **Animation:** brief screen and selection transitions only; honor reduced-motion preferences; no continuous decorative motion.
- **Typography System:** Inter with system sans-serif fallback, compact bold headings, readable mobile body copy, and small uppercase metadata labels.
- **Brand Essence:** a practical way for ABU Main Campus customers and artisans to arrange trusted local services; dependable, clear, respectful.
- **Brand Voice:** concise and privacy-conscious. Examples: “Choose your campus zone.” “Your account stays pending until an administrator reviews it.”
- **Wordmark & Logo:** reuse the supplied wrench/spanner mark paired with the FixMate wordmark.
- **Signature Brand Color:** FixMate emerald `#00875A`.

## Project structure

- `index.html`: app document, viewport metadata, and accessible mounting point.
- `src/main.tsx`, `src/App.tsx`: React bootstrap and role-aware top-level flow for the single declared `/` route.
- `src/lib/supabase.ts`: browser Supabase client using public URL and publishable key only.
- `src/lib/types.ts`, `src/lib/catalog.ts`: FixMate row types, exact pilot categories/zones, and formatting/contact helpers.
- `src/features/auth/`: email-OTP onboarding, role selection, and provider availability messaging.
- `src/components/`: responsive workspace shell, shared forms/status/empty states, WhatsApp support, participant messages, complaint form, and review form.
- `src/features/customer/`: customer verification submission, customer dashboard, requests, offers, messages, reviews, and account.
- `src/features/artisan/`: artisan profile/services/zones, verification submission, dashboard, requests, offers, and messages.
- `src/features/admin/`: protected account directory, private verification review, account actions, complaints, zone settings, and admin contact profile.
- `src/styles.css`, `src/styles/admin-onboarding.css`: reference-derived tokens, responsive layout, focus states, and reduced-motion rules.
- `supabase/migrations/`: versioned category, approval, marketplace, RLS, Storage, privilege, and indexing changes; `supabase/seed.sql` seeds only pilot-zone/contact configuration.
- `public/manus-routes.json`: single public application route declaration at `/`.
- `.env.example`: public Supabase URL/publishable-key variable names only; no credentials.
- `README.md`, `TODO.md`: owner setup/review guidance, full outcome criteria, and progress.

## Build and delivery workflow

Use the already initialized `flexible` WebDev project; do not initialize a second project or enable a separate managed database. Pin the installed pnpm version (`pnpm@11.25.0`) and declare lifecycle-script permissions in `pnpm-workspace.yaml` before installation. Configure TypeScript diagnostics before the first source-code batch. Read the live Supabase schema and policies immediately before writing migrations, then apply versioned changes to the existing project while preserving existing data. Do not create test users, requests, messages, reviews, complaints, or evidence records. Save the application to the canonical project checkpoint for Preview; do not publish. Verify the application build, configured route manifest, RLS/storage policies, and live Preview readiness. Full end-to-end auth and approval tests that require real account records will be performed only when the owner signs into Preview or separately authorizes test records.
