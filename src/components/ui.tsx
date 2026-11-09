import type { ReactNode } from 'react';
import { Check, CircleAlert, Footprints, LoaderCircle, Smartphone, Wrench, Zap } from 'lucide-react';
import type { AccountStatus, ComplaintStatus, CustomerReviewStatus, ArtisanApplicationStatus } from '../lib/types';
import type { ServiceCategory } from '../lib/types';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`} aria-label="FixMate">
      <span className="brand-mark" aria-hidden="true"><Wrench size={18} strokeWidth={2.7} /></span>
      <span className="brand-word">Fix<span>Mate</span></span>
    </div>
  );
}

export function ServiceIcon({ category, size = 19 }: { category: ServiceCategory; size?: number }) {
  const Icon = category === 'electrical_repairs' ? Zap : category === 'phone_computer_repair' ? Smartphone : Footprints;
  return <Icon size={size} aria-hidden="true" />;
}

export function AppHeader({ eyebrow, title, detail, action }: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <header className="app-header">
      <div className="app-header__copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {detail && <p className="muted">{detail}</p>}
      </div>
      {action && <div className="app-header__action">{action}</div>}
    </header>
  );
}

export function StatusPill({ status }: { status: AccountStatus | CustomerReviewStatus | ArtisanApplicationStatus | ComplaintStatus | string }) {
  const positive = ['active', 'approved', 'completed', 'resolved'].includes(status);
  const caution = ['pending_approval', 'submitted', 'in_review', 'needs_more_info', 'open'].includes(status);
  const negative = ['restricted', 'rejected', 'suspended', 'revoked', 'dismissed', 'cancelled'].includes(status);
  const label = status.replaceAll('_', ' ');
  return <span className={`status-pill${positive ? ' status-pill--positive' : ''}${caution ? ' status-pill--caution' : ''}${negative ? ' status-pill--negative' : ''}`}>{label}</span>;
}

export function Button({ children, onClick, type = 'button', variant = 'primary', disabled = false, className = '', ariaLabel }: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`button button--${variant} ${className}`.trim()} aria-label={ariaLabel}>{children}</button>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`.trim()}><span className="field__label">{label}</span>{children}{hint && <span className="field__hint">{hint}</span>}</label>;
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}><CircleAlert size={17} aria-hidden="true" /><span>{children}</span></div>;
}

export function LoadingState({ label = 'Loading your FixMate workspace…' }: { label?: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={24} aria-hidden="true" /><span>{label}</span></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state__mark"><Check size={19} aria-hidden="true" /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}
