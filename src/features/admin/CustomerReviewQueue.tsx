import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileCheck2, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Card, EmptyState, Field, LoadingState, StatusPill } from '../../components/ui';
import { formatDate, whatsAppLink } from '../../lib/catalog';
import type { CustomerReviewStatus, CustomerVerificationSubmission, Profile } from '../../lib/types';

interface DirectoryProfile extends Pick<Profile, 'id' | 'display_name' | 'email' | 'phone' | 'account_status'> {}

export function CustomerReviewQueue({ supabase }: { supabase: SupabaseClient }) {
  const [submissions, setSubmissions] = useState<CustomerVerificationSubmission[]>([]);
  const [people, setPeople] = useState<Record<string, DirectoryProfile>>({});
  const [selectedId, setSelectedId] = useState('');
  const [signedLinks, setSignedLinks] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = useMemo(() => submissions.find((item) => item.id === selectedId) ?? submissions[0], [submissions, selectedId]);
  const person = selected ? people[selected.customer_id] : undefined;

  async function load() {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.from('customer_verification_submissions')
      .select('id, customer_id, profile_photo_path, student_id_path, status, submitted_at, created_at')
      .in('status', ['submitted', 'in_review', 'needs_more_info']).order('created_at', { ascending: true }).limit(200);
    if (queryError) { setError(queryError.message); setSubmissions([]); setLoading(false); return; }
    const next = (data ?? []) as CustomerVerificationSubmission[];
    setSubmissions(next);
    if (next.length && !next.some((item) => item.id === selectedId)) setSelectedId(next[0].id);
    if (!next.length) { setSelectedId(''); setPeople({}); setSignedLinks({}); setLoading(false); return; }
    const customerIds = [...new Set(next.map((item) => item.customer_id))];
    const { data: profileData, error: profileError } = await supabase.from('profiles')
      .select('id, display_name, email, phone, account_status').in('id', customerIds);
    if (profileError) setError(profileError.message);
    const profileMap: Record<string, DirectoryProfile> = {};
    for (const item of (profileData ?? []) as DirectoryProfile[]) profileMap[item.id] = item;
    setPeople(profileMap);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [supabase]);

  useEffect(() => {
    if (!selected) { setSignedLinks({}); return; }
    let alive = true;
    async function signEvidence() {
      const paths = [selected.profile_photo_path, selected.student_id_path].filter((path): path is string => Boolean(path));
      const pairs = await Promise.all(paths.map(async (path) => {
        const { data, error: signError } = await supabase.storage.from('fixmate-verification').createSignedUrl(path, 300);
        if (signError) return [path, ''] as const;
        return [path, data.signedUrl] as const;
      }));
      if (alive) setSignedLinks(Object.fromEntries(pairs));
    }
    void signEvidence();
    return () => { alive = false; };
  }, [supabase, selected?.id]);

  async function decide(status: CustomerReviewStatus) {
    if (!selected) return;
    if (status === 'needs_more_info' && !note.trim()) { setError('Add a brief private note describing what information is needed.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    const { error: rpcError } = await supabase.rpc('fixmate_admin_review_customer_submission', {
      p_submission_id: selected.id,
      p_status: status,
      p_note: note.trim(),
    });
    if (rpcError) setError(rpcError.message);
    else {
      setNotice(`Customer review recorded: ${status.replaceAll('_', ' ')}.`);
      setNote('');
      await load();
    }
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading customer submissions…" />;
  return <section className="admin-section">
    <div className="admin-toolbar"><div><p className="eyebrow">PRIVATE CUSTOMER EVIDENCE</p><h2>Customer approval queue</h2><p className="muted">Review profile photos and ABU student IDs privately. Customer marketplace access remains blocked until approval.</p></div><Button variant="secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button></div>
    {error && <Alert>{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    {!submissions.length ? error ? <EmptyState title="Customer review queue could not load" detail="A live FixMate query failed. Retry before assuming there are no customer submissions." action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>} /> : <EmptyState title="No customer submissions need review" detail="No customer has submitted a verification package in this FixMate project yet." /> : <div className="admin-queue-grid">
      <Card className="admin-queue-list">{submissions.map((item) => { const contact = people[item.customer_id]; return <button type="button" key={item.id} className={`admin-queue-item${(selected?.id ?? '') === item.id ? ' is-active' : ''}`} onClick={() => { setSelectedId(item.id); setNote(''); }}><strong>{contact?.display_name || 'Customer account'}</strong><small>{item.status.replaceAll('_', ' ')} · {item.submitted_at ? formatDate(item.submitted_at) : 'Not submitted'}</small></button>; })}</Card>
      {selected ? <Card className="admin-detail">
        <div className="list-card__top"><div><p className="eyebrow">CUSTOMER SUBMISSION</p><h2>{person?.display_name || 'Customer account'}</h2><div className="list-card__meta"><span>{person?.email || 'No email on profile'}</span><span>{person?.phone || 'No WhatsApp contact saved'}</span></div></div><StatusPill status={selected.status} /></div>
        <p className="field__hint">Submitted {selected.submitted_at ? formatDate(selected.submitted_at) : 'date not recorded'} · account state: {person?.account_status?.replaceAll('_', ' ') ?? 'unknown'}</p>
        <div className="evidence-row"><p className="section-kicker">PRIVATE EVIDENCE</p><div className="button-row">
          {selected.profile_photo_path && signedLinks[selected.profile_photo_path] ? <a className="admin-evidence-link" href={signedLinks[selected.profile_photo_path]} target="_blank" rel="noreferrer"><FileCheck2 size={15} /> Profile photo <ExternalLink size={13} /></a> : <span className="field__hint">Profile photo unavailable</span>}
          {selected.student_id_path && signedLinks[selected.student_id_path] ? <a className="admin-evidence-link" href={signedLinks[selected.student_id_path]} target="_blank" rel="noreferrer"><FileCheck2 size={15} /> ABU student ID <ExternalLink size={13} /></a> : <span className="field__hint">Student ID unavailable</span>}
        </div><p className="field__hint">Signed links expire after five minutes. Keep evidence private; never forward it over WhatsApp.</p></div>
        {person?.phone && <a className="inline-link" href={whatsAppLink(person.phone, `Hello ${person.display_name || 'there'}, FixMate is following up on your customer account review. Please reply here so we can help.`)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Open WhatsApp draft to customer</a>}
        <div className="admin-review-controls"><Field label="Private administrator note" hint="Required when requesting more information; stored in the administrator-only review record."><textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record a concise review note. Do not share ID numbers in the note." /></Field>
          <div className="button-row"><Button variant="secondary" disabled={busy} onClick={() => void decide('in_review')}>Mark in review</Button><Button variant="secondary" disabled={busy} onClick={() => void decide('needs_more_info')}>Request more information</Button><Button disabled={busy} onClick={() => void decide('approved')}><ShieldCheck size={15} /> Approve customer</Button><Button variant="danger" disabled={busy} onClick={() => void decide('rejected')}>Reject</Button></div>
        </div>
      </Card> : null}
    </div>}
  </section>;
}
