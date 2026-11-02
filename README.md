# FixMate Connected MVP

A mobile-first FixMate web app for the ABU Main Campus pilot. It uses the existing FixMate Supabase project and is intended for deployment as a static Vite app.

## Local preview

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm build` runs the strict TypeScript check and production build. The browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the local environment. Only the public publishable key belongs in browser code. Never put a service-role key, Google OAuth client secret, or other secret in a `VITE_*` variable.

## Google sign-in and onboarding

- FixMate uses Google OAuth through Supabase Auth. The app does not collect or store a FixMate password; Google handles authentication.
- In Google Cloud Console, create a **Web application OAuth client**. Add the Supabase Auth callback URL as an authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
- In Supabase Authentication provider settings, enable Google and enter the Google OAuth client ID and client secret. Keep the secret in Supabase, not in this repository or the Netlify build environment.
- In Supabase URL configuration, set the app Site URL and allow the app origins that may receive the OAuth return, such as `https://fixmate-b5ph.netlify.app` and `http://localhost:3000` for local testing. The app sends users back to the current origin after Google authentication.
- Apply `supabase/migrations/20261101190600_fixmate_google_oauth_onboarding.sql` before deploying the updated client. It adds the one-time account-type selection flag and updates the guarded role-selection RPC.
- After Google returns, a new user chooses Customer or Artisan. Customer onboarding collects the profile photo, ABU student ID, and WhatsApp contact. Artisan onboarding collects a profile, service choices, campus zones, WhatsApp contact, and private verification evidence. Service-request location is selected when a customer posts a request.
- The administrator role is assigned by the database from its existing email allowlist when the Google-confirmed email matches. It is not inferred from a frontend email comparison.
- Customer and artisan accounts stay pending until the applicable administrator review is approved. NIN and date of birth are not required by default.

## Pilot scope and safety

Only these services are active: Electrical repairs, Phone and computer repair, and Errands. The 30 selectable zones cover ABU Main Campus only; Kongo Campus and off-campus areas are not included, and zone names are not presented as verified map pins. FixMate does not issue a licence. Private verification files belong in the private `fixmate-verification` bucket and should not be sent over WhatsApp.
