import type { ReactNode } from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandMark } from './ui';
import type { Profile } from '../lib/types';
import type { RealtimeConnectionStatus } from '../lib/useRealtimeRefresh';

export interface WorkspaceNavItem<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export function WorkspaceShell<T extends string>({
  profile,
  roleLabel,
  navItems,
  activeTab,
  onTabChange,
  onSignOut,
  liveStatus,
  children,
}: {
  profile: Profile;
  roleLabel: string;
  navItems: ReadonlyArray<WorkspaceNavItem<T>>;
  activeTab: T;
  onTabChange: (tab: T) => void;
  onSignOut: () => void;
  liveStatus?: RealtimeConnectionStatus;
  children: ReactNode;
}) {
  const displayName = profile.display_name || profile.email || 'FixMate member';
  const initial = (displayName.trim()[0] ?? 'F').toUpperCase();
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar__brand"><BrandMark /></div>
        <nav className="sidebar__nav">
          {navItems.map((item) => <NavButton key={item.id} item={item} active={activeTab === item.id} onSelect={() => onTabChange(item.id)} />)}
        </nav>
        <div className="sidebar__bottom">
          <div className="sidebar__user"><span className="avatar">{initial}</span><span><strong>{displayName}</strong><small>{roleLabel}</small></span></div>
          <button className="nav-link" type="button" onClick={onSignOut}><LogOut size={18} /> Sign out</button>
        </div>
      </aside>
      <div className="mobile-topbar">
        <BrandMark compact />
        <div className="mobile-topbar__right"><span className="avatar" title={displayName}>{initial}</span><button className="icon-button" type="button" onClick={onSignOut} aria-label="Sign out"><LogOut size={18} /></button></div>
      </div>
      <main className="workspace"><div className="workspace__content">{liveStatus && <LiveUpdatesStatus status={liveStatus} />}{children}</div></main>
      <nav className="mobile-nav" aria-label="Workspace tabs">
        {navItems.map((item) => <NavButton key={item.id} item={item} active={activeTab === item.id} onSelect={() => onTabChange(item.id)} />)}
      </nav>
    </div>
  );
}

function NavButton<T extends string>({ item, active, onSelect }: { item: WorkspaceNavItem<T>; active: boolean; onSelect: () => void }) {
  const Icon = item.icon;
  return <button type="button" className={`nav-link${active ? ' is-active' : ''}`} onClick={onSelect} aria-current={active ? 'page' : undefined}><Icon size={18} /><span>{item.label}</span></button>;
}

export function LiveUpdatesStatus({ status }: { status: RealtimeConnectionStatus }) {
  const label = status === 'live'
    ? 'Live updates on'
    : status === 'connecting'
      ? 'Connecting to live updates…'
      : 'Reconnecting · checking periodically';
  return <div className={`live-updates-status live-updates-status--${status}`} role="status" aria-live="polite"><span aria-hidden="true" />{label}</div>;
}

export function AdminHeader({ onSignOut }: { onSignOut: () => void }) {
  return (
    <header className="admin-header">
      <div className="admin-header__title"><BrandMark compact /><span className="admin-lock"><ShieldCheck size={16} /></span><div><h1>Administrator</h1><p>Private review workspace</p></div></div>
      <button className="nav-link" type="button" onClick={onSignOut}><LogOut size={18} /><span>Sign out</span></button>
    </header>
  );
}
