import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Check, Mail, ShieldCheck, UserRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, BrandMark, Button, Field } from '../../components/ui';
import { cleanWhatsAppNumber } from '../../lib/catalog';

interface AuthScreenProps {
  supabase: SupabaseClient;
  onAuthenticated: () => void;
}

type SelectableRole = 'customer' | 'artisan';

export function AuthScreen({ supabase, onAuthenticated }: AuthScreenProps) {
  const [role, setRole] = useState<SelectableRole>('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function requestCode() {
    setBusy(true);
    setError('');
    setNotice('');
    const normalizedEmail = email.trim().toLowerCase();
    const cleanPhone = cleanWhatsAppNumber(phone);
    if (cleanPhone && !/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      setBusy(false);
      setError('Enter a WhatsApp number with 10–15 digits, including the country code if needed.');
      return;
    }
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          data: {
            requested_role: role,
            display_name: name.trim(),
          },
        },
      });
      if (authError) throw authError;
      setEmail(normalizedEmail);
      setStep('code');
      setNotice(`A one-time code was requested for ${normalizedEmail}. Check your inbox and spam folder.`);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'We could not send a code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestCode();
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: 'email',
      });
      if (verifyError) throw verifyError;
      if (!data.user) throw new Error('The email code was accepted, but no account was returned. Please try again.');

      const { error: roleError } = await supabase.rpc('fixmate_set_initial_role', { p_role: role });
      if (roleError) {
        const { data: existingProfile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();
        if (profileError || !existingProfile) throw roleError;
        // Existing account type and administrator allowlist assignment remain authoritative.
      }

      const updates: { display_name?: string; phone?: string } = {};
      if (name.trim()) updates.display_name = name.trim();
      const cleanPhone = cleanWhatsAppNumber(phone);
      if (cleanPhone) updates.phone = cleanPhone;
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', data.user.id);
        if (updateError) throw updateError;
      }
      onAuthenticated();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'We could not verify that code. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <BrandMark />
        <p className="eyebrow">ABU MAIN CAMPUS · ZARIA</p>
        <h1>Good help,<br /><span>close to home.</span></h1>
        <p className="auth-story__lead">Find phone and computer repair, electrical help, and errands—within the ABU Main Campus pilot.</p>
        <div className="auth-trust-note"><ShieldCheck size={19} /><span>Customers and artisans are reviewed by FixMate before they use the marketplace.</span></div>
        <div className="auth-campus-chip"><span className="online-dot" /> ABU Main Campus pilot</div>
      </section>

      <section className="auth-panel card">
        {step === 'details' ? (
          <>
            <div className="auth-panel__heading"><p className="eyebrow">YOUR FIXMATE ACCOUNT</p><h2>Continue with email</h2><p className="muted">We’ll send you a one-time code. No password or phone login.</p></div>
            <div className="role-picker" role="group" aria-label="Choose account type">
              <button type="button" className={`role-picker__option${role === 'customer' ? ' is-selected' : ''}`} onClick={() => setRole('customer')} aria-pressed={role === 'customer'}>
                <span className="role-picker__icon"><UserRound size={19} /></span><span><strong>Customer</strong><small>Find a service</small></span>{role === 'customer' && <Check className="role-picker__check" size={17} />}
              </button>
              <button type="button" className={`role-picker__option${role === 'artisan' ? ' is-selected' : ''}`} onClick={() => setRole('artisan')} aria-pressed={role === 'artisan'}>
                <span className="role-picker__icon"><BriefcaseBusiness size={19} /></span><span><strong>Artisan</strong><small>Offer a service</small></span>{role === 'artisan' && <Check className="role-picker__check" size={17} />}
              </button>
            </div>
            <form onSubmit={sendCode} className="form-stack">
              <Field label="Email address"><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></Field>
              <details className="optional-details">
                <summary>Add your name and WhatsApp contact <span>(optional now)</span></summary>
                <div className="form-stack optional-details__body">
                  <Field label="Your name"><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /></Field>
                  <Field label="WhatsApp number" hint="Collected for account contact, not sign-in. Keep it private."><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812 345 6789" /></Field>
                </div>
              </details>
              {error && <Alert>{error}</Alert>}
              {notice && <Alert tone="info">{notice}</Alert>}
              <Button type="submit" disabled={busy}>{busy ? 'Sending code…' : <>Send email code <ArrowRight size={17} /></>}</Button>
            </form>
            <div className="auth-divider"><span>or</span></div>
            <button className="google-button" type="button" disabled aria-describedby="google-status">Continue with Google</button>
            <p id="google-status" className="field__hint google-status">Google sign-in is not enabled in the current FixMate Supabase project yet.</p>
            <p className="privacy-copy">NIN and date of birth are not required by default. Customer access begins only after the required private ABU student-ID review and administrator approval.</p>
          </>
        ) : (
          <>
            <button type="button" className="back-link" onClick={() => { setStep('details'); setError(''); setNotice(''); }}><ArrowLeft size={16} /> Edit email</button>
            <div className="auth-panel__heading"><p className="eyebrow">EMAIL VERIFICATION</p><h2>Enter your code</h2><p className="muted">We sent a code to <strong>{email}</strong>. Your WhatsApp number is not used to log in.</p></div>
            <form onSubmit={verifyCode} className="form-stack">
              <Field label="One-time email code"><input inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\s/g, ''))} placeholder="Enter the code from your email" /></Field>
              {error && <Alert>{error}</Alert>}
              {notice && <Alert tone="info">{notice}</Alert>}
              <Button type="submit" disabled={busy}>{busy ? 'Verifying…' : <>Verify and continue <ArrowRight size={17} /></>}</Button>
              <Button type="button" variant="quiet" disabled={busy} onClick={() => { setStep('details'); setError(''); }}>Use a different email</Button>
            </form>
            <button type="button" className="text-button" disabled={busy} onClick={() => { void requestCode(); }}><Mail size={15} /> Resend code</button>
          </>
        )}
        <div className="auth-footer"><span>Private by default</span><span>·</span><span>ABU Main Campus only</span></div>
      </section>
    </main>
  );
}
