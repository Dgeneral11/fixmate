import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseClient: SupabaseClient | null =
  projectUrl && publishableKey
    ? createClient(projectUrl, publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const supabaseConfigurationReady = Boolean(supabaseClient);
