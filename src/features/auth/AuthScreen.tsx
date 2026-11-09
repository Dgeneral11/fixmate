import { useState } from 'react';
import { Alert, BrandMark } from '../../components/ui';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AuthScreenProps {
  supabase: SupabaseClient;
}

export function AuthScreen({ supabase }: AuthScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function continueWithGoogle() {
    setBusy(true);
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (authError) throw authError;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Could not start Google sign-in. Please try again.');
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <BrandMark />
        <p className="eyebrow">TRUSTED LOCAL SERVICES</p>
        <h1>Good help,<br /><span>close to home.</span></h1>
        <p className="auth-story__lead">Find skilled help for electrical repairs, phone and computer repair, and everyday errands.</p>
        <div className="auth-trust-note"><span aria-hidden="true">✓</span><span>Reviewed artisans and clear requests, with help when you need it.</span></div>
        <div className="auth-campus-chip"><span className="online-dot" /> Service areas shown when you request</div>
      </section>

      <section className="auth-panel card">
        <div className="auth-panel__heading">
          <p className="eyebrow">YOUR FIXMATE ACCOUNT</p>
          <h2>Continue with Google</h2>
          <p className="muted">Google securely handles sign-in. You will choose Customer or Artisan and complete your FixMate details next.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        <button className="google-button" type="button" onClick={() => void continueWithGoogle()} disabled={busy}>
          <span className="google-button__mark" aria-hidden="true">G</span>
          {busy ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
        <p className="privacy-copy">FixMate does not ask for or store your Google password. Customer and artisan access requires the relevant FixMate review. NIN and date of birth are not required by default.</p>
        <div className="auth-footer"><span>Private by default</span><span>·</span><span>Reviewed providers</span></div>
      </section>
    </main>
  );
}
