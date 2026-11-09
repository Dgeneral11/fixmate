import { useCallback, useState } from 'react';
import { ClipboardList, FileCheck2, History, MapPinned, MessageSquareWarning, Search, Settings2, UsersRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AdminHeader, LiveUpdatesStatus } from '../../components/WorkspaceShell';
import { useRealtimeRefresh, type RealtimeTableSubscription } from '../../lib/useRealtimeRefresh';
import type { Profile } from '../../lib/types';
import { AdminOverview } from './AdminOverview';
import { AdminContactAndZones } from './AdminContactAndZones';
import { ArtisanReviewQueue } from './ArtisanReviewQueue';
import { CustomerReviewQueue } from './CustomerReviewQueue';
import { UserDirectory } from './UserDirectory';
import { ComplaintQueue } from './ComplaintQueue';
import { AdminHistory } from './AdminHistory';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

const ADMIN_TABLES: readonly RealtimeTableSubscription[] = ['profiles','customer_verification_submissions','artisan_verification_applications','artisan_verification_checks','artisan_verification_documents','user_complaints','customer_requests','artisan_offers','fixmate_request_events','pilot_service_zones','artisan_profiles','artisan_service_zones','fixmate_contact_settings'].map((table) => ({ table }));

type AdminTab = 'overview' | 'customers' | 'artisans' | 'people' | 'history' | 'complaints' | 'settings';
const tabs: ReadonlyArray<{ id: AdminTab; label: string; icon: typeof ClipboardList }> = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'customers', label: 'Customers', icon: FileCheck2 },
  { id: 'artisans', label: 'Artisans', icon: UsersRound },
  { id: 'people', label: 'All accounts', icon: Search },
  { id: 'history', label: 'Job history', icon: History },
  { id: 'complaints', label: 'Complaints', icon: MessageSquareWarning },
  { id: 'settings', label: 'Profile & zones', icon: MapPinned },
];

export function AdminDashboard({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const refresh = useCallback(() => setRefreshRevision((value) => value + 1), []);
  const liveStatus = useRealtimeRefresh({ supabase, identity: profile.id, scope: 'admin', tables: ADMIN_TABLES, onChange: refresh });
  return (
    <div className="admin-shell">
      <AdminHeader onSignOut={onSignOut} />
      <main className="admin-content">
        <div className="admin-welcome"><div><p className="eyebrow">PRIVATE CONTROL PANEL</p><h2>{profile.display_name || 'FixMate administrator'}</h2><p className="muted">Review submissions, manage accounts, and oversee marketplace activity.</p></div><span className="admin-role-badge"><Settings2 size={16} /> Administrator</span></div>
        <nav className="tab-row admin-tabs" aria-label="Administrator sections">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={`tab-button${tab === item.id ? ' is-active' : ''}`} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><Icon size={15} /> {item.label}</button>; })}</nav>
        <LiveUpdatesStatus status={liveStatus} />
        {tab === 'overview' && <AdminOverview refreshRevision={refreshRevision} supabase={supabase} onOpen={setTab} />}
        {tab === 'customers' && <CustomerReviewQueue refreshRevision={refreshRevision} supabase={supabase} />}
        {tab === 'artisans' && <ArtisanReviewQueue refreshRevision={refreshRevision} supabase={supabase} administratorId={profile.id} />}
        {tab === 'people' && <UserDirectory refreshRevision={refreshRevision} supabase={supabase} />}
        {tab === 'history' && <AdminHistory refreshRevision={refreshRevision} supabase={supabase} />}
        {tab === 'complaints' && <ComplaintQueue refreshRevision={refreshRevision} supabase={supabase} />}
        {tab === 'settings' && <AdminContactAndZones refreshRevision={refreshRevision} supabase={supabase} />}
        <button type="button" className="admin-refresh-link" onClick={() => void onRefresh()}>Refresh account role</button>
      </main>
    </div>
  );
}
