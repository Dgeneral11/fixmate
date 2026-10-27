# Authentication module

The UI uses Supabase email one-time codes. WhatsApp numbers are profile contact fields, never login credentials. Google sign-in remains disabled until the existing Supabase project enables that provider. Account roles and administrator access are read from RLS-protected database profiles and server-enforced RPCs.
