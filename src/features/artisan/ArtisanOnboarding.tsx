import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, FileCheck2, FileUp, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppHeader, Alert, Button, Card, Field, LoadingState, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { ARTISAN_APPLICATION_STATUSES, cleanWhatsAppNumber, groupZones, SERVICE_CATEGORIES } from '../../lib/catalog';
import type { ArtisanApplication, ArtisanDocument, ArtisanProfile, Profile, ServiceCategory, ServiceZone } from '../../lib/types';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

const navItems: ReadonlyArray<WorkspaceNavItem<'verification'>> = [
  { id: 'verification', label: 'Verification', icon: ShieldCheck },
];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type EvidenceKind = 'identity_document' | 'trade_credential' | 'safety_evidence' | 'assessment_evidence';

export function ArtisanOnboarding({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [artisan, setArtisan] = useState<ArtisanProfile | null>(null);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [documents, setDocuments] = useState<ArtisanDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(profile.display_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [route, setRoute] = useState<'trade_credential' | 'alternative_assessment'>('trade_credential');
  const [years, setYears] = useState('');
  const [bio, setBio] = useState('');
  const [notes, setNotes] = useState('');
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [identityFile, setIdentityFile] = useState<File | null>(null);
  const [tradeFile, setTradeFile] = useState<File | null>(null);
  const [safetyFile, setSafetyFile] = useState<File | null>(null);
  const [assessmentFile, setAssessmentFile] = useState<File | null>(null);
  const loadGeneration = useRef(0);

  async function loadOnboarding(background = false, initializeRole = false) {
    const generation = ++loadGeneration.current;
    if (!background) setLoading(true);
    setError('');
    if (initializeRole) {
      const { error: roleError } = await supabase.rpc('fixmate_set_initial_role', { p_role: 'artisan' });
      if (roleError) setError(roleError.message);
    }
    const [profileResult, zoneResult, applicationResult, zoneLinkResult] = await Promise.all([
      supabase.from('artisan_profiles').select('user_id, display_name, service_categories, years_experience, service_area, bio, is_available').eq('user_id', profile.id).maybeSingle(),
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').eq('is_active', true).order('sort_order'),
      supabase.from('artisan_verification_applications').select('id, artisan_id, route, status, applicant_notes, submitted_at, created_at').eq('artisan_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('artisan_service_zones').select('zone_id').eq('artisan_id', profile.id),
    ]);
    const firstError = profileResult.error ?? zoneResult.error ?? applicationResult.error ?? zoneLinkResult.error;
    if (firstError && background) {
      if (generation === loadGeneration.current) { setError(firstError.message); setLoading(false); }
      return;
    }
    if (firstError) setError(firstError.message);
    const artisanData = profileResult.data as ArtisanProfile | null;
    const appData = applicationResult.data as ArtisanApplication | null;
    setArtisan(artisanData);
    setZones((zoneResult.data ?? []) as ServiceZone[]);
    setApplication(appData);
    setSelectedZones((zoneLinkResult.data ?? []).map((item: { zone_id: string }) => item.zone_id));
    if (artisanData) {
      setName(artisanData.display_name || profile.display_name || '');
      setCategories(artisanData.service_categories ?? []);
      setYears(artisanData.years_experience == null ? '' : String(artisanData.years_experience));
      setBio(artisanData.bio ?? '');
    }
    if (appData) {
      const { data: docData, error: docError } = await supabase.from('artisan_verification_documents')
        .select('id, application_id, uploaded_by, document_type, storage_path, created_at')
        .eq('application_id', appData.id).order('created_at', { ascending: true });
      if (docError && background) {
        if (generation === loadGeneration.current) { setError(docError.message); setLoading(false); }
        return;
      }
      if (generation !== loadGeneration.current) return;
      setRoute(appData.route);
      setNotes(appData.applicant_notes ?? '');
      if (docError) setError(docError.message);
      setDocuments((docData ?? []) as ArtisanDocument[]);
    } else {
      setDocuments([]);
    }
    setLoading(false);
  }

  const liveStatus = useRealtimeRefresh({
    supabase,
    identity: profile.id,
    scope: 'artisan-onboarding',
    tables: [
      { table: 'artisan_verification_applications', filter: `artisan_id=eq.${profile.id}` },
      { table: 'artisan_verification_documents', filter: `uploaded_by=eq.${profile.id}` },
      { table: 'artisan_profiles', filter: `user_id=eq.${profile.id}` },
      { table: 'artisan_service_zones', filter: `artisan_id=eq.${profile.id}` },
      { table: 'pilot_service_zones' },
    ],
    onChange: () => loadOnboarding(true),
  });

  useEffect(() => { void loadOnboarding(false, true); }, [profile.id]);

  const groupedZones = useMemo(() => groupZones(zones), [zones]);
  const status = application?.status;
  const submitted = status === 'submitted' || status === 'in_review';
  const needsMore = status === 'needs_more_info';
  const profileChangedAfterApproval = status === 'approved' && profile.account_status === 'pending_approval';
  const canEdit = !status || status === 'draft' || needsMore;
  const checkedDocs = (kind: EvidenceKind) => documents.some((doc) => doc.document_type === kind);

  function toggleCategory(category: ServiceCategory) {
    setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  function toggleZone(zoneId: string) {
    setSelectedZones((current) => current.includes(zoneId) ? current.filter((id) => id !== zoneId) : [...current, zoneId]);
  }

  function checkFile(file: File | null): string | null {
    if (!file) return null;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return 'Evidence files must be PDF, JPG, or PNG.';
    if (file.size > MAX_FILE_BYTES) return 'Each evidence file must be 8 MB or smaller.';
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const cleanPhone = cleanWhatsAppNumber(phone);
    if (!name.trim()) { setError('Enter your name.'); return; }
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) { setError('Enter a WhatsApp contact number with 10–15 digits.'); return; }
    if (categories.length === 0) { setError('Select at least one FixMate pilot service.'); return; }
    if (selectedZones.length === 0) { setError('Select at least one service zone.'); return; }
    if (!identityFile && !checkedDocs('identity_document')) { setError('Upload an identity document.'); return; }
    if (route === 'trade_credential' && !tradeFile && !checkedDocs('trade_credential')) { setError('Upload proof of trade skills or an applicable association credential.'); return; }
    if (route === 'alternative_assessment' && !notes.trim()) { setError('Describe your trade experience so FixMate can plan the alternative assessment.'); return; }
    for (const file of [identityFile, tradeFile, safetyFile, assessmentFile]) {
      const fileError = checkFile(file);
      if (fileError) { setError(fileError); return; }
    }

    setBusy(true);
    try {
      const { error: profileError } = await supabase.from('profiles')
        .update({ display_name: name.trim(), phone: cleanPhone })
        .eq('id', profile.id);
      if (profileError) throw profileError;
      if (!artisan) throw new Error('The artisan profile is not ready. Please reload and try again.');

      const { error: artisanError } = await supabase.from('artisan_profiles').update({
        display_name: name.trim(),
        service_categories: categories,
        years_experience: years.trim() ? Number(years) : null,
        bio: bio.trim() || null,
      }).eq('user_id', profile.id);
      if (artisanError) throw artisanError;

      const { error: removeZonesError } = await supabase.from('artisan_service_zones').delete().eq('artisan_id', profile.id);
      if (removeZonesError) throw removeZonesError;
      const { error: addZonesError } = await supabase.from('artisan_service_zones').insert(selectedZones.map((zone_id) => ({ artisan_id: profile.id, zone_id })));
      if (addZonesError) throw addZonesError;

      let activeApplication = application;
      if (!activeApplication) {
        const { data, error: createError } = await supabase.from('artisan_verification_applications')
          .insert({ artisan_id: profile.id, route, status: 'draft', applicant_notes: notes.trim() || null })
          .select('id, artisan_id, route, status, applicant_notes, submitted_at, created_at')
          .single();
        if (createError) throw createError;
        activeApplication = data as ArtisanApplication;
      } else {
        const { error: draftError } = await supabase.from('artisan_verification_applications')
          .update({ route, applicant_notes: notes.trim() || null })
          .eq('id', activeApplication.id);
        if (draftError) throw draftError;
      }

      const uploadList: Array<{ file: File | null; kind: EvidenceKind }> = [
        { file: identityFile, kind: 'identity_document' },
        { file: route === 'trade_credential' ? tradeFile : assessmentFile, kind: route === 'trade_credential' ? 'trade_credential' : 'assessment_evidence' },
        { file: safetyFile, kind: 'safety_evidence' },
      ];
      for (const item of uploadList) {
        if (!item.file) continue;
        const path = await uploadArtisanEvidence(supabase, profile.id, activeApplication.id, item.file, item.kind);
        const { error: docError } = await supabase.from('artisan_verification_documents').insert({
          application_id: activeApplication.id,
          uploaded_by: profile.id,
          document_type: item.kind,
          storage_path: path,
        });
        if (docError) throw docError;
      }

      const { data: submittedApplication, error: submitError } = await supabase.from('artisan_verification_applications')
        .update({ status: 'submitted', applicant_notes: notes.trim() || null, submitted_at: new Date().toISOString() })
        .eq('id', activeApplication.id)
        .select('id, artisan_id, route, status, applicant_notes, submitted_at, created_at')
        .single();
      if (submitError) throw submitError;
      setApplication(submittedApplication as ArtisanApplication);
      setIdentityFile(null);
      setTradeFile(null);
      setSafetyFile(null);
      setAssessmentFile(null);
      await loadOnboarding();
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'We could not submit your profile. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading artisan review requirements…" />;
  if (!status || canEdit) {
    return (
      <WorkspaceShell profile={profile} roleLabel="Artisan · pending approval" navItems={navItems} activeTab="verification" liveStatus={liveStatus} onTabChange={() => undefined} onSignOut={onSignOut}>
        <AppHeader eyebrow="ARTISAN ACCOUNT" title="Set up your artisan profile" detail="Every artisan profile is reviewed by a FixMate administrator before verified-provider access is enabled." action={<Button variant="quiet" onClick={onSignOut}>Sign out</Button>} />
        {error && <Alert>{error}</Alert>}
        {needsMore && <div className="status-banner"><div><strong>More information requested</strong><p>Update your profile or add evidence, then resubmit for administrator review.</p></div><StatusPill status={status} /></div>}
        <Card className="card-pad onboarding-card">
          <div className="card-heading"><div><p className="eyebrow">ARTISAN PROFILE & EVIDENCE</p><h2>Your work, your service zones</h2><p>FixMate may contact you via WhatsApp, request missing information, arrange a physical meeting, or check trade experience.</p></div><span className="onboarding-shield"><BriefcaseBusiness size={21} /></span></div>
          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Full name"><input required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
              <Field label="WhatsApp contact" hint="Private account contact; not used to log in."><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0812 345 6789" /></Field>
            </div>
            <Field label="Service categories" hint="Choose the service categories you can currently offer.">
              <div className="checkbox-list">{SERVICE_CATEGORIES.map((item) => <label key={item.value} className="checkbox-option"><input type="checkbox" checked={categories.includes(item.value)} onChange={() => toggleCategory(item.value)} /><span>{item.label}</span></label>)}</div>
            </Field>
            <Field label="Service zones" hint="Choose every active service zone where you can provide service.">
              {groupedZones.map(([group, items]) => <div className="zone-checkbox-group" key={group}><h4>{group}</h4><div className="zone-grid">{items.map((zone) => <label key={zone.id} className="zone-option"><input type="checkbox" checked={selectedZones.includes(zone.id)} onChange={() => toggleZone(zone.id)} /><span>{zone.name}</span></label>)}</div></div>)}
            </Field>
            <div className="form-grid">
              <Field label="Years of trade experience" hint="Optional"><input type="number" min="0" max="60" value={years} onChange={(event) => setYears(event.target.value)} placeholder="e.g. 3" /></Field>
              <Field label="Verification route"><select value={route} onChange={(event) => setRoute(event.target.value as 'trade_credential' | 'alternative_assessment')}><option value="trade_credential">Trade evidence</option><option value="alternative_assessment">Alternative practical assessment</option></select></Field>
            </div>
            <Field label="About your work" hint="Short description of experience and services. Do not include private ID numbers."><textarea maxLength={1200} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Describe the work you do on campus." /></Field>
            {route === 'alternative_assessment' && <Field label="Trade experience for the assessment" hint="FixMate may arrange a physical meeting to check your experience."><textarea required maxLength={1600} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe your relevant trade experience and the kinds of work you can demonstrate." /></Field>}
            {route === 'trade_credential' && <Field label="Trade experience or notes for the administrator" hint="Association credentials may be included with your trade evidence where applicable."><textarea maxLength={1600} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context that may help the private review." /></Field>}
            <div className="form-grid">
              <Field label={`Identity document${checkedDocs('identity_document') ? ' (already submitted)' : ''}`} hint="PDF, JPG, or PNG · max 8 MB"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setIdentityFile(event.target.files?.[0] ?? null)} /></Field>
              {route === 'trade_credential' ? <Field label={`Proof of trade skills${checkedDocs('trade_credential') ? ' (already submitted)' : ''}`} hint="A trade or applicable association credential · PDF, JPG, or PNG · max 8 MB"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setTradeFile(event.target.files?.[0] ?? null)} /></Field> : <Field label="Assessment evidence (optional)" hint="PDF, JPG, or PNG · max 8 MB"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setAssessmentFile(event.target.files?.[0] ?? null)} /></Field>}
            </div>
            <Field label={`Safety evidence (optional${checkedDocs('safety_evidence') ? ' · already submitted' : ''})`} hint="The administrator may also review safety as part of the private verification process."><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setSafetyFile(event.target.files?.[0] ?? null)} /></Field>
            <div className="privacy-notice"><LockKeyhole size={17} /><p>Evidence is private and visible only to you and authorized FixMate administrators. No licence is issued. WhatsApp is for contact only; do not send identity documents in a chat.</p></div>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" disabled={busy}>{busy ? 'Saving and uploading privately…' : <><FileUp size={17} /> Submit profile for review</>}</Button>
          </form>
        </Card>
      </WorkspaceShell>
    );
  }

  const statusLabel = status ? ARTISAN_APPLICATION_STATUSES[status] : 'Not submitted';
  return (
    <WorkspaceShell profile={profile} roleLabel="Artisan · under review" navItems={navItems} activeTab="verification" liveStatus={liveStatus} onTabChange={() => undefined} onSignOut={onSignOut}>
      <AppHeader eyebrow="ARTISAN VERIFICATION" title={profileChangedAfterApproval ? 'Profile update under review' : submitted ? 'Your application is under review' : 'Verification status'} detail="A FixMate administrator reviews artisan profiles and evidence privately." action={<Button variant="quiet" onClick={onSignOut}>Sign out</Button>} />
      {error && <Alert>{error}</Alert>}
      <Card className="card-pad">
        <div className="card-heading"><div><p className="eyebrow">CURRENT STATUS</p><h2>{profileChangedAfterApproval ? 'The marketplace is paused while the profile change is checked.' : submitted ? 'Thanks for submitting your profile.' : `Application: ${statusLabel}`}</h2><p>{profileChangedAfterApproval ? 'An artisan profile change requires another administrator review before the profile can use verified-provider features.' : 'FixMate may contact you via WhatsApp for missing information or to arrange a physical meeting and check trade experience.'}</p></div><span className="onboarding-shield"><ShieldCheck size={22} /></span></div>
        {status && <StatusPill status={status} />}
        {status && ['submitted', 'in_review'].includes(status) && <p className="review-sla">Review is expected within 12 hours. If there is no update after 12 hours, contact FixMate support/admin.</p>}
        {documents.length > 0 && <div className="file-selection">{documents.map((doc) => <span key={doc.id}><FileCheck2 size={15} /> {doc.document_type.replaceAll('_', ' ')}</span>)}</div>}
        <div className="button-row"><WhatsAppSupport supabase={supabase} /><Button variant="quiet" onClick={() => void loadOnboarding()}>Refresh status</Button></div>
      </Card>
    </WorkspaceShell>
  );
}

async function uploadArtisanEvidence(supabase: SupabaseClient, userId: string, applicationId: string, file: File, kind: EvidenceKind): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${userId}/${applicationId}/${kind}-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('fixmate-verification').upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw error;
  return path;
}
