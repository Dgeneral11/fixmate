import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, AppHeader, Button, Card, EmptyState, Field, LoadingState, StatusPill } from '../../components/ui';
import { formatDate } from '../../lib/catalog';
import type { ComplaintStatus, CustomerRequest, UserComplaint } from '../../lib/types';

interface Person { id: string; display_name: string; email: string | null; phone: string | null }

export function ComplaintQueue({ supabase }: { supabase: SupabaseClient }) {
  const [complaints, setComplaints] = useState<UserComplaint[]>([]);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [requests, setRequests] = useState<Record<string, CustomerRequest>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.from('user_complaints')
      .select('id, request_id, reporter_id, subject_user_id, reason, details, status, created_at')
      .order('created_at', { ascending: false }).limit(200);
    if (queryError) { setError(queryError.message); setComplaints([]); setLoading(false); return; }
    const next = (data ?? []) as UserComplaint[];
    setComplaints(next);
    const personIds = [...new Set(next.flatMap((item) => [item.reporter_id, item.subject_user_id]))];
    const requestIds = [...new Set(next.map((item) => item.request_id))];
    const [profileResult, requestResult] = personIds.length ? await Promise.all([
      supabase.from('profiles').select('id, display_name, email, phone').in('id', personIds),
      supabase.from('customer_requests').select('id, customer_id, service_category, zone_id, title, description, status, created_at').in('id', requestIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (profileResult.error || requestResult.error) setError(profileResult.error?.message ?? requestResult.error?.message ?? 'Could not load complaint details.');
    const profileMap: Record<string, Person> = {};
    for (const item of (profileResult.data ?? []) as Person[]) profileMap[item.id] = item;
    const requestMap: Record<string, CustomerRequest> = {};
    for (const item of (requestResult.data ?? []) as CustomerRequest[]) requestMap[item.id] = item;
    setPeople(profileMap);
    setRequests(requestMap);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [supabase]);

  async function review(complaintId: string, status: ComplaintStatus) {
    setBusyId(complaintId);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('fixmate_submit_complaint_review', {
      p_complaint_id: complaintId,
      p_status: status,
      p_note: notes[complaintId]?.trim() ?? '',
    });
    if (rpcError) setError(rpcError.message);
    else { setNotice(`Complaint marked ${status.replaceAll('_', ' ')}.`); setNotes((current) => ({ ...current, [complaintId]: '' })); await load(); }
    setBusyId('');
  }

  if (loading) return <LoadingState label="Loading private complaint reports…" />;
  return <section className="admin-section">
    <AppHeader eyebrow="PRIVATE USER REPORTS" title="Complaints & safety reports" detail="Complaints are visible only to the reporter and FixMate administrators. Record the next step in an administrator-only note." action={<Button variant="secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button>} />
    {error && <Alert>{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    {!complaints.length ? error ? <EmptyState title="Complaint inbox could not load" detail="A live FixMate query failed. Retry before assuming no complaints have been submitted." action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>} /> : <EmptyState title="No complaints have been submitted" detail="Real customer and artisan reports will appear here if they are filed from an eligible service request." /> : <div className="list-stack">{complaints.map((complaint) => {
      const reporter = people[complaint.reporter_id];
      const subject = people[complaint.subject_user_id];
      const request = requests[complaint.request_id];
      return <Card className="card-pad complaint-admin-card" key={complaint.id}><div className="list-card__top"><div><p className="eyebrow">{complaint.reason.replaceAll('_', ' ')} · {formatDate(complaint.created_at)}</p><h3>{request?.title || 'Service request'}</h3></div><StatusPill status={complaint.status} /></div><p className="list-card__body">{complaint.details}</p><div className="list-card__meta"><span>Reporter: {reporter?.display_name || 'User'} {reporter?.email ? `· ${reporter.email}` : ''}</span><span>Reported account: {subject?.display_name || 'User'} {subject?.email ? `· ${subject.email}` : ''}</span></div><Field label="Administrator-only note"><textarea maxLength={2000} value={notes[complaint.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [complaint.id]: event.target.value }))} placeholder="Record actions or resolution notes." /></Field><div className="button-row"><Button variant="secondary" disabled={busyId === complaint.id} onClick={() => void review(complaint.id, 'in_review')}><AlertTriangle size={15} /> Mark in review</Button><Button disabled={busyId === complaint.id} onClick={() => void review(complaint.id, 'resolved')}>Resolve</Button><Button variant="quiet" disabled={busyId === complaint.id} onClick={() => void review(complaint.id, 'dismissed')}>Dismiss</Button></div></Card>;
    })}</div>}
  </section>;
}
