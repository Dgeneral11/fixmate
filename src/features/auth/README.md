# Authentication module

FixMate uses Google OAuth through Supabase Auth. The app does not collect or store a separate FixMate password. A user selects **Continue with Google**, authenticates with Google, and returns to the FixMate site origin.

New pending profiles are routed to a one-time Customer/Artisan selection step after sign-in. The selection is recorded through the guarded `fixmate_set_initial_role` RPC. The migration `20261101190600_fixmate_google_oauth_onboarding.sql` adds the persisted selection flag; apply it before deploying the client. Existing profiles are marked as already classified by the migration so they continue through their current onboarding or dashboard route.

The Google OAuth Web client ID and secret are configured in Supabase Authentication provider settings. The Google authorized redirect URI is the Supabase project's `/auth/v1/callback`. The FixMate application origin must also be included in Supabase Auth URL configuration. Never put the Google client secret or a Supabase service-role key in frontend code or a `VITE_*` variable.

The administrator role is assigned by the database from the existing allowlist when the Google-authenticated email is confirmed. Customer and artisan marketplace access remains subject to the corresponding FixMate review process. WhatsApp numbers are private profile contacts, not login credentials.
