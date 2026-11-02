import { useState } from 'react';
import { BriefcaseBusiness, UserRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, BrandMark, Button, Card } from '../../components/ui';
import type { FixmateRole, Profile } from '../../lib/types';

type SelectableRole = Extract<FixmateRole, 'customer' | 'artisan'>;

export function AccountTypeSelection({ supabase, profile, onRefresh, onSignOut }: {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [role, setRole] = useState<SelectableRole>('customer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function continueSetup() {
    setBusy(true);
    setError('');
    try {
      const { error: roleError } = await supabase.rpc('fixmate_set_initial_role', { p_role: role });
      if (roleError) throw roleError;
      await onRefresh();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Could not save your account type. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-screen">
      <Card className="card-pad account-type-card">
        <BrandMark />
        <p className="eyebrow">GOOGLE SIGN-IN COMPLETE</p>
        <h1>How will you use FixMate?</h1>
        <p className="muted">Choose an account type. You will add your contact details and any required verification next.</p>
        {error && <Alert>{error}</Alert>}
        <div className="role-picker" role="group" aria-label="Choose account type">
          <button type="button" className={`role-picker__option${role === 'customer' ? ' is-selected' : ''}`} onClick={() => setRole('customer')} aria-pressed={role === 'customer'}>
            <span className="role-picker__icon"><UserRound size={19} /></span>
            <span><strong>Customer</strong><small>Find a service</small></span>
          </button>
          <button type="button" className={`role-picker__option${role === 'artisan' ? ' is-selected' : ''}`} onClick={() => setRole('artisan')} aria-pressed={role === 'artisan'}>
            <span className="role-picker__icon"><BriefcaseBusiness size={19} /></span>
            <span><strong>Artisan</strong><small>Offer a service</small></span>
          </button>
        </div>
        <Button type="button" disabled={busy} onClick={() => void continueSetup()}>{busy ? 'Saving…' : 'Continue'}</Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={onSignOut}>Sign out</Button>
        <p className="field__hint">Signed in as {profile.email || 'your Google account'}.</p>
      </Card>
    </main>
  );
}
