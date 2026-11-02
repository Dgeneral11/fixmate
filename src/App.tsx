import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { Alert, BrandMark, Button, LoadingState } from './components/ui';
import { WhatsAppSupport } from './components/WhatsAppSupport';
import { supabaseClient } from './lib/supabase';
import type { Profile } from './lib/types';

const AuthScreen = lazy(() => import('./features/auth/AuthScreen').then((module) => ({ default: module.AuthScreen })));
const AccountTypeSelection = lazy(() => import('./features/auth/AccountTypeSelection').then((module) => ({ default: module.AccountTypeSelection })));
const AdminDashboard = lazy(() => import('./features/admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard })));
const ArtisanDashboard = lazy(() => import('./features/artisan/ArtisanDashboard').then((module) => ({ default: module.ArtisanDashboard })));
const ArtisanOnboarding = lazy(() => import('./features/artisan/ArtisanOnboarding').then((module) => ({ default: module.ArtisanOnboarding })));
const CustomerDashboard = lazy(() => import('./features/customer/CustomerDashboard').then((module) => ({ default: module.CustomerDashboard })));
const CustomerOnboarding = lazy(() => import('./features/customer/CustomerOnboarding').then((module) => ({ default: module.CustomerOnboarding })));

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }
    let alive = true;
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) setProfileError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setProfile(null);
      setProfileError('');
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!supabaseClient || !session?.user) return;
    setProfileLoading(true);
    setProfileError('');
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, role, display_name, email, phone, account_status, account_type_selected')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) {
      setProfileError(error.message);
      setProfile(null);
    } else {
      setProfile(data as Profile | null);
    }
    setProfileLoading(false);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    void refreshProfile();
  }, [session?.user?.id, refreshProfile]);

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    setProfile(null);
    setSession(null);
  }

  if (!supabaseClient) {
    return <main className="setup-screen"><BrandMark /><div className="card"><p className="eyebrow">SETUP NEEDED</p><h1>Supabase connection is not configured</h1><p className="muted">Add the existing FixMate project URL and publishable key to the local environment, then restart the preview. Do not use a service-role key in the browser.</p><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_PUBLISHABLE_KEY</code></div></main>;
  }

  if (authLoading) return <LoadingState label="Connecting securely to FixMate…" />;
  if (!session) return <Suspense fallback={<LoadingState label="Loading FixMate sign-in…" />}><AuthScreen supabase={supabaseClient} /></Suspense>;

  if (profileLoading) return <LoadingState label="Loading your account status…" />;
  if (profileError) {
    return <main className="setup-screen"><BrandMark /><div className="card"><Alert>{profileError}</Alert><div className="button-row"><Button onClick={() => void refreshProfile()}><RefreshCw size={16} /> Try again</Button><Button variant="quiet" onClick={() => void signOut()}><LogOut size={16} /> Sign out</Button></div></div></main>;
  }
  if (!profile) {
    return <main className="setup-screen"><BrandMark /><div className="card"><span className="status-icon"><ShieldCheck size={22} /></span><h1>Profile is being prepared</h1><p className="muted">Your sign-in worked, but FixMate could not load the linked profile. Please retry or sign out and try again.</p><div className="button-row"><Button onClick={() => void refreshProfile()}><RefreshCw size={16} /> Reload profile</Button><Button variant="quiet" onClick={() => void signOut()}><LogOut size={16} /> Sign out</Button></div></div></main>;
  }

  const shared = { supabase: supabaseClient, profile, onRefresh: refreshProfile, onSignOut: signOut };
  if (profile.role === 'administrator') return <Suspense fallback={<LoadingState label="Loading administrator workspace…" />}><AdminDashboard {...shared} /></Suspense>;
  if (profile.account_status === 'restricted' || profile.account_status === 'rejected') {
    return <Suspense fallback={<LoadingState label="Loading account status…" />}><AccessNotice profile={profile} supabase={supabaseClient} onSignOut={signOut} /></Suspense>;
  }
  if (profile.account_status === 'pending_approval' && !profile.account_type_selected) {
    return <Suspense fallback={<LoadingState label="Preparing your FixMate setup…" />}><AccountTypeSelection {...shared} /></Suspense>;
  }
  if (profile.role === 'customer') {
    return profile.account_status === 'active'
      ? <Suspense fallback={<LoadingState label="Loading customer workspace…" />}><CustomerDashboard {...shared} /></Suspense>
      : <Suspense fallback={<LoadingState label="Loading customer review steps…" />}><CustomerOnboarding {...shared} /></Suspense>;
  }
  return profile.account_status === 'active'
    ? <Suspense fallback={<LoadingState label="Loading artisan workspace…" />}><ArtisanDashboard {...shared} /></Suspense>
    : <Suspense fallback={<LoadingState label="Loading artisan review steps…" />}><ArtisanOnboarding {...shared} /></Suspense>;
}

function AccessNotice({ profile, supabase, onSignOut }: {
  profile: Profile;
  supabase: NonNullable<typeof supabaseClient>;
  onSignOut: () => void;
}) {
  const restricted = profile.account_status === 'restricted';
  return (
    <main className="access-notice">
      <BrandMark />
      <div className="card access-notice__card">
        <span className={`status-icon${restricted ? ' status-icon--warn' : ''}`}><ShieldCheck size={24} /></span>
        <p className="eyebrow">ACCOUNT STATUS</p>
        <h1>{restricted ? 'This account is restricted' : 'This application was not approved'}</h1>
        <p className="muted">{restricted ? 'Marketplace access is paused while an administrator reviews this account.' : 'An administrator did not approve this application. Contact FixMate if you need clarification.'}</p>
        <WhatsAppSupport supabase={supabase} className="button button--secondary" label="Contact FixMate on WhatsApp" message="Hello FixMate, I need help with my account status." />
        <Button variant="quiet" onClick={() => void supabase.auth.signOut().then(onSignOut)}><LogOut size={16} /> Sign out</Button>
      </div>
    </main>
  );
}
