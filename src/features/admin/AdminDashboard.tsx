import { useState } from 'react';
import { ClipboardList, FileCheck2, MapPinned, MessageSquareWarning, Search, Settings2, UsersRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AdminHeader } from '../../components/WorkspaceShell';
import type { Profile } from '../../lib/types';
import { AdminOverview } from './AdminOverview';
import { AdminContactAndZones } from './AdminContactAndZones';
import { ArtisanReviewQueue } from './ArtisanReviewQueue';
import { CustomerReviewQueue } from './CustomerReviewQueue';
import { UserDirectory } from './UserDirectory';
import { ComplaintQueue } from './ComplaintQueue';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

type AdminTab = 'overview' | 'customers' | 'artisans' | 'people' | 'complaints' | 'settings';
const tabs: ReadonlyArray<{ id: AdminTab; label: string; icon: typeof ClipboardList }> = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'customers', label: 'Customers', icon: FileCheck2 },
  { id: 'artisans', label: 'Artisans', icon: UsersRound },
  { id: 'people', label: 'All accounts', icon: Search },
  { id: 'complaints', label: 'Complaints', icon: MessageSquareWarning },
  { id: 'settings', label: 'Profile & zones', icon: MapPinned },
];

export function AdminDashboard({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [tab, setTab] = useState<AdminTab>('overview');
  return (
    <div className="admin-shell">
      <AdminHeader onSignOut={onSignOut} />
      <main className="admin-content">
        <div className="admin-welcome"><div><p className="eyebrow">PRIVATE CONTROL PANEL</p><h2>{profile.display_name || 'FixMate administrator'}</h2><p className="muted">Review submissions, manage accounts, and keep the pilot within ABU Main Campus.</p></div><span className="admin-role-badge"><Settings2 size={16} /> Administrator</span></div>
        <nav className="tab-row admin-tabs" aria-label="Administrator sections">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={`tab-button${tab === item.id ? ' is-active' : ''}`} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon size={15} /> {item.label}</button>; })}</nav>
        {tab === 'overview' && <AdminOverview supabase={supabase} onOpen={setTab} />}
        {tab === 'customers' && <CustomerReviewQueue supabase={supabase} />}
        {tab === 'artisans' && <ArtisanReviewQueue supabase={supabase} administratorId={profile.id} />}
        {tab === 'people' && <UserDirectory supabase={supabase} />}
        {tab === 'complaints' && <ComplaintQueue supabase={supabase} />}
        {tab === 'settings' && <AdminContactAndZones supabase={supabase} />}
        <button type="button" className="admin-refresh-link" onClick={() => void onRefresh()}>Refresh account role</button>
      </main>
    </div>
  );
}
