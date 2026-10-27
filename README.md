# FixMate Connected MVP

A mobile-first FixMate web app for the ABU Main Campus pilot. It continues the standalone reference at `fixmate-mvp-preview.html` and uses the existing FixMate Supabase project.

## Local preview

The WebDev Preview runs on port 3000. From this project directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm build` runs the strict TypeScript check and production build. The browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the local environment. Only the public publishable key belongs in browser code; never put a service-role key or other secret in `VITE_*` variables.

## Sign-in and approvals

- Email one-time-code sign-in is implemented. Google is shown as unavailable because Google OAuth is not enabled in the existing Supabase project.
- The administrator role is assigned by the database from its existing allowlist; it is not inferred from a frontend email comparison. Sign in with the allowlisted administrator email using its email code. Never share that code.
- Customers must submit a profile photo and ABU student ID through the private verification flow, then wait for administrator approval before using the marketplace. NIN and date of birth are not required by default.
- Artisans submit their profile, WhatsApp contact, selected services/zones, and applicable private verification evidence; an administrator records the checks and approval.
- Customer and artisan WhatsApp numbers are private account contacts. FixMate’s support link uses the administrator-configured `08144196124` number and does not send a message automatically.

## Pilot scope and safety

Only these services are active: Electrical repairs, Phone and computer repair, and Errands. The 30 selectable zones cover ABU Main Campus only; Kongo Campus and off-campus areas are not included, and zone names are not presented as verified map pins. FixMate does not issue a licence. The old license table and its data are preserved but its client API access and status-sync trigger are disabled.

The Preview connects to the existing live Supabase project. No test accounts, sample marketplace records, or evidence files were created. Avoid creating any during review unless separately authorized. Full sign-in, uploads, and approval walkthroughs require the owner to use real email addresses and documents in the Preview.

The standalone HTML file is only an interaction/design prototype; it does not store real accounts or evidence. This project is not published.
