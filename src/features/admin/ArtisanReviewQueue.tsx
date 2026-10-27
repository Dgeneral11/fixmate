import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileCheck2, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Card, EmptyState, Field, LoadingState, StatusPill } from '../../components/ui';
import { formatDate, whatsAppLink } from '../../lib/catalog';
import type { ArtisanApplication, ArtisanDocument, ArtisanProfile, Profile, ServiceZone, VerificationCheck } from '../../lib/types';

interface ArtisanReviewItem {
  application: ArtisanApplication;
  profile: Pick<Profile, 'id' | 'display_name' | 'email' | 'phone' | 'account_status'>;
  artisan: ArtisanProfile | undefined;
}
interface CheckDraft { status: VerificationCheck['status']; note: string }

type QueueView = 'action' | 'verified' | 'all';

export function ArtisanReviewQueue({ supabase, administratorId }: { supabase: SupabaseClient; administratorId: string }) {
  const [items, setItems] = useState<ArtisanReviewItem[]>([]);
  const [checks, setChecks] = useState<VerificationCheck[]>([]);
  const [documents, setDocuments] = useState<ArtisanDocument[]>([]);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [zoneLinks, setZoneLinks] = useState<Array<{ artisan_id: string; zone_id: string }>>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<QueueView>('action');
  const [note, setNote] = useState('');
  const [checkDrafts, setCheckDrafts] = useState<Record<string, CheckDraft>>({});
  const [signedLinks, setSignedLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = useMemo(() => items.find((item) => item.application.id === selectedId) ?? items[0], [items, selectedId]);
  const selectedChecks = checks.filter((check) => check.application_id === selected?.application.id);
  const selectedDocs = documents.filter((doc) => doc.application_id === selected?.application.id);

  async function load() {
    setLoading(true);
    setError('');
    const [appResult, zoneResult] = await Promise.all([
      supabase.from('artisan_verification_applications').select('id, artisan_id, route, status, applicant_notes, submitted_at, created_at').order('created_at', { ascending: true }).limit(250),
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').order('sort_order'),
    ]);
    if (appResult.error || zoneResult.error) setError(appResult.error?.message ?? zoneResult.error?.message ?? 'Could not load artisan applications.');
    const apps = (appResult.data ?? []) as ArtisanApplication[];
    const artisanIds = [...new Set(apps.map((item) => item.artisan_id))];
    const [profileResult, artisanResult] = artisanIds.length ? await Promise.all([
      supabase.from('profiles').select('id, display_name, email, phone, account_status').in('id', artisanIds),
      supabase.from('artisan_profiles').select('user_id, display_name, service_categories, years_experience, service_area, bio, is_available').in('user_id', artisanIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (profileResult.error || artisanResult.error) setError(profileResult.error?.message ?? artisanResult.error?.message ?? 'Could not load artisan profiles.');
    const profiles = new Map(((profileResult.data ?? []) as Array<Pick<Profile, 'id' | 'display_name' | 'email' | 'phone' | 'account_status'>>).map((item) => [item.id, item]));
    const artisanProfiles = new Map(((artisanResult.data ?? []) as ArtisanProfile[]).map((item) => [item.user_id, item]));
    const nextItems = apps.flatMap((application) => {
      const p = profiles.get(application.artisan_id);
      if (!p) return [];
      return [{ application, profile: p, artisan: artisanProfiles.get(application.artisan_id) }];
    });
    setItems(nextItems);
    setZones((zoneResult.data ?? []) as ServiceZone[]);
    const appIds = apps.map((item) => item.id);
    const [checkResult, docResult, zoneLinkResult] = appIds.length ? await Promise.all([
      supabase.from('artisan_verification_checks').select('id, application_id, check_type, status, private_notes').in('application_id', appIds).order('created_at'),
      supabase.from('artisan_verification_documents').select('id, application_id, uploaded_by, document_type, storage_path, created_at').in('application_id', appIds).order('created_at'),
      supabase.from('artisan_service_zones').select('artisan_id, zone_id').in('artisan_id', artisanIds),
    ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    if (checkResult.error || docResult.error || zoneLinkResult.error) setError(checkResult.error?.message ?? docResult.error?.message ?? zoneLinkResult.error?.message ?? 'Could not load private evidence metadata.');
    const nextChecks = (checkResult.data ?? []) as VerificationCheck[];
    setChecks(nextChecks);
    setDocuments((docResult.data ?? []) as ArtisanDocument[]);
    setZoneLinks((zoneLinkResult.data ?? []) as Array<{ artisan_id: string; zone_id: string }>);
    const drafts: Record<string, CheckDraft> = {};
    for (const check of nextChecks) drafts[check.id] = { status: check.status, note: check.private_notes ?? '' };
    setCheckDrafts(drafts);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [supabase]);

  useEffect(() => {
    if (!selectedDocs.length) { setSignedLinks({}); return; }
    let alive = true;
    async function signDocs() {
      const pairs = await Promise.all(selectedDocs.map(async (doc) => {
        const { data, error: signError } = await supabase.storage.from('fixmate-verification').createSignedUrl(doc.storage_path, 300);
        return [doc.id, signError ? '' : data.signedUrl] as const;
      }));
      if (alive) setSignedLinks(Object.fromEntries(pairs));
    }
    void signDocs();
    return () => { alive = false; };
  }, [supabase, selected?.application.id, documents]);

  const visibleItems = items.filter(({ application, profile }) => {
    const needsAction = ['submitted', 'in_review', 'needs_more_info'].includes(application.status)
      || (application.status === 'approved' && profile.account_status === 'pending_approval');
    const verified = application.status === 'approved' && profile.account_status === 'active';
    return filter === 'action' ? needsAction : filter === 'verified' ? verified : true;
  });

  async function updateCheck(check: VerificationCheck) {
    const draft = checkDrafts[check.id];
    if (!draft) return;
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.from('artisan_verification_checks').update({
      status: draft.status,
      private_notes: draft.note.trim() || null,
      checked_by: administratorId,
      checked_at: new Date().toISOString(),
    }).eq('id', check.id);
    if (updateError) setError(updateError.message);
    else { setNotice('Private verification check saved.'); await load(); }
    setBusy(false);
  }

  async function decide(status: ArtisanApplication['status']) {
    if (!selected) return;
    if (status === 'needs_more_info' && !note.trim()) { setError('Add a private note before requesting more information.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    if (note.trim()) {
      const { error: noteError } = await supabase.from('artisan_verification_admin_notes').insert({
        application_id: selected.application.id,
        administrator_id: administratorId,
        note: note.trim(),
      });
      if (noteError) {
        setError(`The private review note could not be recorded, so the decision was not changed: ${noteError.message}`);
        setBusy(false);
        return;
      }
    }
    const { error: updateError } = await supabase.from('artisan_verification_applications').update({
      status,
      reviewed_by: administratorId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', selected.application.id);
    if (updateError) setError(updateError.message);
    else { setNotice(`Artisan verification status saved: ${status.replaceAll('_', ' ')}.`); setNote(''); await load(); }
    setBusy(false);
  }

  const itemForSelected = selected ? visibleItems.find((item) => item.application.id === selected.application.id) : undefined;
  const selectedIdSafe = itemForSelected?.application.id ?? visibleItems[0]?.application.id ?? '';
  useEffect(() => { if (selectedIdSafe && selectedId !== selectedIdSafe) setSelectedId(selectedIdSafe); }, [selectedIdSafe, selectedId]);
  const zoneNames = selected ? zoneLinks.filter((link) => link.artisan_id === selected.application.artisan_id).map((link) => {
    const zone = zones.find((item) => item.id === link.zone_id);
    return zone ? `${zone.name}${zone.is_active ? '' : ' (paused)'}` : '';
  }).filter(Boolean) : [];

  if (loading) return <LoadingState label="Loading artisan verification reviews…" />;
  return <section className="admin-section">
    <div className="admin-toolbar"><div><p className="eyebrow">FIXMATE ARTISAN VERIFICATION</p><h2>Artisan approval queue</h2><p className="muted">Identity, safety, and the selected skill route must pass before FixMate verification can be approved. No licence is issued.</p></div><Button variant="secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button></div>
    <div className="admin-filter-tabs">{(['action', 'verified', 'all'] as const).map((value) => <button type="button" key={value} className={`chip-tab${filter === value ? ' is-active' : ''}`} onClick={() => setFilter(value)}>{value === 'action' ? 'Needs action' : value === 'verified' ? 'Verified artisans' : 'All applications'}</button>)}</div>
    {error && <Alert>{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    {!visibleItems.length ? error ? <EmptyState title="Artisan review queue could not load" detail="A live FixMate query failed. Retry before assuming there are no applications." action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>} /> : <EmptyState title={filter === 'verified' ? 'No verified artisans in this view' : 'No artisan applications need review'} detail="Artisan records appear here when a real profile is submitted to FixMate. No sample profiles are added." /> : <div className="admin-queue-grid">
      <Card className="admin-queue-list">{visibleItems.map(({ application, profile: person }) => <button key={application.id} type="button" className={`admin-queue-item${(selected?.application.id ?? '') === application.id ? ' is-active' : ''}`} onClick={() => { setSelectedId(application.id); setNote(''); }}><strong>{person.display_name || 'Artisan account'}</strong><small>{application.status.replaceAll('_', ' ')} · {person.account_status.replaceAll('_', ' ')}</small></button>)}</Card>
      {selected ? <Card className="admin-detail">
        <div className="list-card__top"><div><p className="eyebrow">{selected.application.route.replaceAll('_', ' ')} ROUTE</p><h2>{selected.profile.display_name || 'Artisan account'}</h2><div className="list-card__meta"><span>{selected.profile.email || 'No email on profile'}</span><span>{selected.profile.phone || 'No WhatsApp contact saved'}</span></div></div><StatusPill status={selected.application.status} /></div>
        <p className="field__hint">Account state: {selected.profile.account_status.replaceAll('_', ' ')} · submitted {selected.application.submitted_at ? formatDate(selected.application.submitted_at) : 'date not recorded'}</p>
        <div className="admin-artisan-summary"><strong>Profile summary</strong><p>{selected.artisan?.bio || 'No profile description provided.'}</p><p className="field__hint">Services: {selected.artisan?.service_categories.map((value) => value.replaceAll('_', ' ')).join(', ') || 'None listed'} · Experience: {selected.artisan?.years_experience ?? 'Not provided'} years</p><p className="field__hint">Availability: {selected.artisan?.is_available ? 'Available' : 'Paused'}</p><p className="field__hint">Active campus zones: {zoneNames.join(', ') || 'Review zone links in profile settings'}</p><p className="list-card__body">Applicant notes: {selected.application.applicant_notes || 'None'}</p></div>
        {selected.profile.phone && <a className="inline-link" href={whatsAppLink(selected.profile.phone, `Hello ${selected.profile.display_name || 'there'}, FixMate is following up about your artisan profile review. Please reply here so we can arrange any required next steps.`)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Open WhatsApp draft to artisan</a>}
        <div className="admin-review-controls"><p className="section-kicker">PRIVATE VERIFICATION EVIDENCE</p>{selectedDocs.length ? <div className="button-row">{selectedDocs.map((doc) => signedLinks[doc.id] ? <a key={doc.id} className="admin-evidence-link" href={signedLinks[doc.id]} target="_blank" rel="noreferrer"><FileCheck2 size={15} /> {doc.document_type.replaceAll('_', ' ')} <ExternalLink size={13} /></a> : <span key={doc.id} className="field__hint">Private file unavailable</span>)}</div> : <p className="field__hint">No evidence file rows are attached to this application yet.</p>}<p className="field__hint">Signed evidence links expire after five minutes. Keep all documents private and out of WhatsApp messages.</p></div>
        <div className="admin-review-controls"><p className="section-kicker">VERIFICATION CHECKS</p>{selectedChecks.map((check) => {
          const draft = checkDrafts[check.id] ?? { status: check.status, note: check.private_notes ?? '' };
          return <div className="admin-check-card" key={check.id}><div className="admin-check-row"><label>{check.check_type.replaceAll('_', ' ')}</label><select value={draft.status} onChange={(event) => setCheckDrafts((current) => ({ ...current, [check.id]: { ...draft, status: event.target.value as VerificationCheck['status'] } }))}><option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="needs_more_info">Needs more information</option><option value="not_applicable">Not applicable</option></select></div><Field label="Private check note"><input maxLength={2000} value={draft.note} onChange={(event) => setCheckDrafts((current) => ({ ...current, [check.id]: { ...draft, note: event.target.value } }))} placeholder="Administrator-only note" /></Field><Button variant="quiet" disabled={busy} onClick={() => void updateCheck(check)}>Save check</Button></div>;
        })}</div>
        <Field label="Administrator note" hint="Required when requesting more information. These notes are private."><textarea maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the reason or next step." /></Field>
        <div className="button-row admin-decision-buttons"><Button variant="secondary" disabled={busy} onClick={() => void decide('in_review')}>Mark in review</Button><Button variant="secondary" disabled={busy} onClick={() => void decide('needs_more_info')}>Request more information</Button><Button disabled={busy} onClick={() => void decide('approved')}><ShieldCheck size={15} /> Approve FixMate verification</Button><Button variant="danger" disabled={busy} onClick={() => void decide('rejected')}>Reject</Button>{selected.application.status === 'approved' && <><Button variant="danger" disabled={busy} onClick={() => void decide('suspended')}>Suspend verification</Button><Button variant="danger" disabled={busy} onClick={() => void decide('revoked')}>Revoke verification</Button></>}</div>
      </Card> : null}
    </div>}
  </section>;
}
