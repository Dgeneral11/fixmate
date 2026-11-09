import { useEffect, useState } from 'react';
import { ArrowRight, FileCheck2, UsersRound, AlertTriangle, UserRoundCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, AppHeader, Card, LoadingState } from '../../components/ui';

type QueueTab = 'customers' | 'artisans' | 'people' | 'complaints';
interface Counts { customers: number; artisans: number; people: number; complaints: number }

export function AdminOverview({ supabase, onOpen, refreshRevision = 0 }: { supabase: SupabaseClient; onOpen: (tab: QueueTab) => void; refreshRevision?: number }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    async function load() {
      const [customerResult, artisanResult, profileResult, complaintResult] = await Promise.all([
        supabase.from('customer_verification_submissions').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'in_review', 'needs_more_info']),
        supabase.from('artisan_verification_applications').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'in_review', 'needs_more_info']),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('user_complaints').select('id', { count: 'exact', head: true }).in('status', ['submitted', 'in_review']),
      ]);
      const firstError = customerResult.error ?? artisanResult.error ?? profileResult.error ?? complaintResult.error;
      if (!alive) return;
      if (firstError) setError(firstError.message);
      else setCounts({ customers: customerResult.count ?? 0, artisans: artisanResult.count ?? 0, people: profileResult.count ?? 0, complaints: complaintResult.count ?? 0 });
    }
    void load();
    return () => { alive = false; };
  }, [supabase, refreshRevision]);
  if (error) return <Alert>{error}</Alert>;
  if (!counts) return <LoadingState label="Loading live administrator queues…" />;
  const metrics = [
    { label: 'Customer reviews awaiting action', value: counts.customers, icon: FileCheck2, tab: 'customers' as const },
    { label: 'Artisan reviews awaiting action', value: counts.artisans, icon: UsersRound, tab: 'artisans' as const },
    { label: 'Open complaints', value: counts.complaints, icon: AlertTriangle, tab: 'complaints' as const },
    { label: 'Accounts in this project', value: counts.people, icon: UserRoundCheck, tab: 'people' as const },
  ];
  return <>
    <AppHeader eyebrow="LIVE DATABASE COUNTS" title="Review activity" detail="Counts are read from the connected FixMate project. No sample accounts or activity are added." />
    <div className="metric-row admin-metrics">{metrics.map((item) => { const Icon = item.icon; return <button key={item.label} className="metric-card metric-card--button" type="button" onClick={() => onOpen(item.tab)}><Icon size={19} color="#00875a" /><div className="metric-card__value">{item.value}</div><div className="metric-card__label">{item.label}</div><span className="metric-card__arrow"><ArrowRight size={15} /></span></button>; })}</div>
    <Card className="card-pad admin-guidance"><p className="eyebrow">ADMINISTRATOR SAFEGUARDS</p><h2>Review privately, approve deliberately</h2><div className="section-grid"><p className="muted">Customer access stays blocked until the profile photo and ABU student ID are reviewed and approved.</p><p className="muted">Artisan verification requires identity and safety checks, plus the selected trade-credential or alternative-assessment check. FixMate does not issue licences.</p></div></Card>
  </>;
}
