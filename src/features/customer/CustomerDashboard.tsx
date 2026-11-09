import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, CheckCheck, ClipboardList, Compass, MessageSquareText, Search, Settings2, Star, UserRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { Alert, AppHeader, Button, Card, EmptyState, Field, LoadingState, ServiceIcon, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { cleanWhatsAppNumber, formatDate, formatNaira, groupZones, SERVICE_CATEGORIES, serviceLabel } from '../../lib/catalog';
import type { ArtisanOffer, ArtisanProfile, CustomerRequest, FixmateRequestEvent, JobReview, Profile, ServiceCategory, ServiceZone } from '../../lib/types';
import { ComplaintForm } from '../shared/ComplaintForm';
import { MessagesPanel, type ConversationRef } from '../shared/MessagesPanel';
import { RequestAttachments } from '../shared/RequestAttachments';
import { RequestHistory } from '../shared/RequestHistory';
import { ReviewForm } from '../shared/ReviewForm';
import { ArtisanProfilePage } from './ArtisanProfilePage';
import { DirectServiceRequestPage } from './DirectServiceRequestPage';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

type CustomerTab = 'discover' | 'requests' | 'messages' | 'account' | 'artisan-profile' | 'direct-request';
const navItems: ReadonlyArray<WorkspaceNavItem<CustomerTab>> = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'requests', label: 'Requests', icon: ClipboardList },
  { id: 'messages', label: 'Messages', icon: MessageSquareText },
  { id: 'account', label: 'Account', icon: UserRound },
];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 5;

export function CustomerDashboard({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [activeTab, setActiveTab] = useState<CustomerTab>('discover');
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [offers, setOffers] = useState<ArtisanOffer[]>([]);
  const [artisans, setArtisans] = useState<ArtisanProfile[]>([]);
  const [artisanZones, setArtisanZones] = useState<Array<{ artisan_id: string; zone_id: string }>>([]);
  const [artisanNames, setArtisanNames] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<JobReview[]>([]);
  const [requestEvents, setRequestEvents] = useState<FixmateRequestEvent[]>([]);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [filterCategory, setFilterCategory] = useState<ServiceCategory | ''>('');
  const [filterZone, setFilterZone] = useState('');
  const [requestCategory, setRequestCategory] = useState<ServiceCategory>('electrical_repairs');
  const [requestZone, setRequestZone] = useState('');
  const [requestTitle, setRequestTitle] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [requestFiles, setRequestFiles] = useState<File[]>([]);
  const [profileArtisan, setProfileArtisan] = useState<ArtisanProfile | null>(null);
  const [directTarget, setDirectTarget] = useState<ArtisanProfile | null>(null);
  const [accountName, setAccountName] = useState(profile.display_name);
  const [accountPhone, setAccountPhone] = useState(profile.phone ?? '');
  const [accountSaved, setAccountSaved] = useState(false);
  const loadGeneration = useRef(0);

  async function loadData(background = false) {
    const generation = ++loadGeneration.current;
    if (!background) setLoading(true);
    setError('');
    setLoadError('');
    const [zoneResult, requestResult, artisanResult, artisanZoneResult] = await Promise.all([
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').eq('is_active', true).order('sort_order'),
      supabase.from('customer_requests').select('id, customer_id, target_artisan_id, service_category, zone_id, title, description, status, created_at').eq('customer_id', profile.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('artisan_profiles').select('user_id, display_name, service_categories, years_experience, service_area, bio, is_available').order('updated_at', { ascending: false }).limit(100),
      supabase.from('artisan_service_zones').select('artisan_id, zone_id').limit(500),
    ]);
    const firstError = zoneResult.error ?? requestResult.error ?? artisanResult.error ?? artisanZoneResult.error;
    if (firstError && background) {
      if (generation === loadGeneration.current) { setLoadError(firstError.message); setLoading(false); }
      return;
    }
    if (firstError) setLoadError(firstError.message);
    const nextZones = (zoneResult.data ?? []) as ServiceZone[];
    const nextRequests = (requestResult.data ?? []) as CustomerRequest[];
    const nextArtisans = (artisanResult.data ?? []) as ArtisanProfile[];
    const nextOffers: ArtisanOffer[] = [];
    const nextReviews: JobReview[] = [];
    const nextEvents: FixmateRequestEvent[] = [];
    const nextNames: Record<string, string> = {};
    const requestIds = nextRequests.map((item) => item.id);

    if (requestIds.length) {
      const [offerResult, reviewResult, eventResult] = await Promise.all([
        supabase.from('artisan_offers').select('id, request_id, artisan_id, quote_ngn, message, status, created_at')
          .in('request_id', requestIds).order('created_at', { ascending: true }).limit(500),
        supabase.from('job_reviews').select('id, request_id, customer_id, artisan_id, rating, review, created_at')
          .in('request_id', nextRequests.filter((item) => item.status === 'completed').map((item) => item.id)),
        supabase.from('fixmate_request_events').select('id, request_id, actor_id, event_type, details, created_at')
          .in('request_id', requestIds).order('created_at', { ascending: true }).limit(1000),
      ]);
      const relatedError = offerResult.error ?? reviewResult.error ?? eventResult.error;
      if (relatedError && background) {
        if (generation === loadGeneration.current) { setLoadError(relatedError.message); setLoading(false); }
        return;
      }
      if (offerResult.error) setLoadError(offerResult.error.message);
      else nextOffers.push(...((offerResult.data ?? []) as ArtisanOffer[]));
      if (reviewResult.error) setLoadError(reviewResult.error.message);
      else nextReviews.push(...((reviewResult.data ?? []) as JobReview[]));
      if (eventResult.error) setLoadError(eventResult.error.message);
      else nextEvents.push(...((eventResult.data ?? []) as FixmateRequestEvent[]));
    }
    const artisanIds = [...new Set(nextOffers.map((item) => item.artisan_id))];
    if (artisanIds.length) {
      const { data: nameData, error: nameError } = await supabase.from('artisan_profiles').select('user_id, display_name').in('user_id', artisanIds);
      if (nameError && background) {
        if (generation === loadGeneration.current) { setLoadError(nameError.message); setLoading(false); }
        return;
      }
      if (nameError) setLoadError(nameError.message);
      for (const item of nameData ?? []) nextNames[item.user_id] = item.display_name || 'Verified artisan';
    }

    if (generation !== loadGeneration.current) return;
    setZones(nextZones);
    setRequests(nextRequests);
    setOffers(nextOffers);
    setArtisans(nextArtisans);
    setArtisanZones((artisanZoneResult.data ?? []) as Array<{ artisan_id: string; zone_id: string }>);
    setArtisanNames(nextNames);
    setReviews(nextReviews);
    setRequestEvents(nextEvents);
    if (!requestZone && nextZones[0]) setRequestZone(nextZones[0].id);
    setLoading(false);
  }

  const liveStatus = useRealtimeRefresh({
    supabase,
    identity: profile.id,
    scope: 'customer-dashboard',
    tables: [
      { table: 'customer_requests', filter: `customer_id=eq.${profile.id}` },
      { table: 'artisan_offers' },
      { table: 'job_reviews', filter: `customer_id=eq.${profile.id}` },
      { table: 'fixmate_request_events' },
      { table: 'artisan_profiles' },
      { table: 'artisan_service_zones' },
      { table: 'pilot_service_zones' },
    ],
    onChange: () => loadData(true),
  });
  useRealtimeRefresh({
    supabase,
    identity: profile.id,
    scope: 'customer-request-attachments',
    tables: [{ table: 'customer_request_attachments' }],
    onChange: () => setAttachmentRevision((revision) => revision + 1),
  });

  useEffect(() => { void loadData(); }, [profile.id]);
  useEffect(() => { if (activeTab === 'messages') void loadData(true); }, [activeTab, profile.id]);

  const zoneName = (id: string) => zones.find((zone) => zone.id === id)?.name ?? 'Service zone';
  const visibleArtisans = useMemo(() => artisans.filter((artisan) => {
    const matchesCategory = !filterCategory || artisan.service_categories.includes(filterCategory);
    const matchesZone = !filterZone || artisanZones.some((item) => item.artisan_id === artisan.user_id && item.zone_id === filterZone);
    return matchesCategory && matchesZone;
  }), [artisans, artisanZones, filterCategory, filterZone]);
  useEffect(() => {
    if (profileArtisan) {
      const current = artisans.find((item) => item.user_id === profileArtisan.user_id);
      if (current) setProfileArtisan(current);
      else {
        setProfileArtisan(null);
        setActiveTab('discover');
        setNotice('This artisan is no longer listed as verified. Choose another artisan or use matching.');
      }
    }
    if (directTarget) {
      const current = artisans.find((item) => item.user_id === directTarget.user_id);
      if (!current?.is_available) {
        setDirectTarget(null);
        setProfileArtisan(null);
        setActiveTab('discover');
        setNotice('That artisan is no longer available. Choose another verified artisan or use matching.');
      } else setDirectTarget(current);
    }
  }, [artisans, profileArtisan?.user_id, directTarget?.user_id]);
  const conversations: ConversationRef[] = offers.map((offer) => {
    const request = requests.find((item) => item.id === offer.request_id);
    return { offerId: offer.id, requestId: offer.request_id, requestTitle: request?.title ?? 'Service request', otherName: artisanNames[offer.artisan_id] ?? 'Verified artisan', status: offer.status };
  });

  async function uploadRequestPhotos(requestId: string, files: File[]): Promise<number> {
    let failures = 0;
    for (const file of files) {
      const extension = file.type === 'image/png' ? 'png' : 'jpg';
      const path = `request-attachments/${profile.id}/${requestId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('fixmate-marketplace-media').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
      if (uploadError) { failures += 1; continue; }
      const { error: metadataError } = await supabase.from('customer_request_attachments').insert({ request_id: requestId, uploaded_by: profile.id, storage_path: path });
      if (metadataError) { await supabase.storage.from('fixmate-marketplace-media').remove([path]); failures += 1; }
    }
    return failures;
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice('');
    if (!requestZone) { setError('Choose an active service zone.'); return; }
    if (requestFiles.length > MAX_IMAGES) { setError(`Choose no more than ${MAX_IMAGES} reference photos.`); return; }
    for (const file of requestFiles) {
      if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Reference photos must be JPG or PNG images.'); return; }
      if (file.size > MAX_IMAGE_BYTES) { setError('Each reference photo must be 8 MB or smaller.'); return; }
    }
    setBusy(true);
    const { data: request, error: insertError } = await supabase.from('customer_requests').insert({
      customer_id: profile.id, target_artisan_id: null, service_category: requestCategory,
      zone_id: requestZone, title: requestTitle.trim(), description: requestDescription.trim(), status: 'open',
    }).select('id').single();
    if (insertError) setError(insertError.message);
    else {
      const failed = requestFiles.length ? await uploadRequestPhotos(request.id, requestFiles) : 0;
      setNotice(failed ? `Request posted. ${failed} reference photo${failed === 1 ? '' : 's'} could not be attached.` : 'Request posted to eligible artisans in the matching pool.');
      setRequestTitle(''); setRequestDescription(''); setRequestFiles([]);
      setActiveTab('requests');
      await loadData();
    }
    setBusy(false);
  }

  async function respondToOffer(offerId: string, accept: boolean) {
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('fixmate_customer_respond_to_offer', { p_offer_id: offerId, p_accept: accept });
    if (rpcError) setError(rpcError.message);
    else await loadData();
    setBusy(false);
  }

  async function updateRequestStatus(requestId: string, action: 'cancel' | 'complete') {
    setBusy(true); setError('');
    const { error: rpcError } = action === 'cancel'
      ? await supabase.rpc('fixmate_customer_cancel_request', { p_request_id: requestId })
      : await supabase.rpc('fixmate_complete_request', { p_request_id: requestId });
    if (rpcError) setError(rpcError.message);
    else await loadData();
    setBusy(false);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAccountSaved(false); setError('');
    const phone = cleanWhatsAppNumber(accountPhone);
    if (!/^\+?[0-9]{10,15}$/.test(phone)) { setError('Enter a WhatsApp contact number with 10–15 digits.'); return; }
    setBusy(true);
    const { error: updateError } = await supabase.from('profiles').update({ display_name: accountName.trim(), phone }).eq('id', profile.id);
    if (updateError) setError(updateError.message);
    else { setAccountSaved(true); await onRefresh(); }
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading FixMate services…" />;
  const groupedZones = groupZones(zones);

  return (
    <WorkspaceShell profile={profile} roleLabel="Approved customer" navItems={navItems} activeTab={activeTab} liveStatus={liveStatus} onTabChange={(tab) => { setProfileArtisan(null); setDirectTarget(null); setActiveTab(tab); }} onSignOut={onSignOut}>
      {error && <Alert>{error}</Alert>}{loadError && <Alert>{loadError}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}

      {activeTab === 'artisan-profile' && profileArtisan && <ArtisanProfilePage supabase={supabase} artisan={profileArtisan} onBack={() => { setProfileArtisan(null); setActiveTab('discover'); }} onRequestService={(artisan) => { setDirectTarget(artisan); setActiveTab('direct-request'); }} />}
      {activeTab === 'direct-request' && directTarget && <DirectServiceRequestPage supabase={supabase} customer={profile} artisan={directTarget} zones={zones} onBack={() => setActiveTab('artisan-profile')} onSubmitted={(partialNotice) => { setNotice(partialNotice || `Direct request sent to ${directTarget.display_name || 'the selected artisan'}.`); setProfileArtisan(null); setDirectTarget(null); setActiveTab('requests'); void loadData(); }} />}

      {activeTab === 'discover' && <>
        <AppHeader eyebrow="LOCAL SERVICES" title="Find trusted local help" detail="Choose a verified artisan or post to the matching pool—both options are available." action={<Button onClick={() => document.getElementById('request-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Request through matching</Button>} />
        <div className="service-grid">{SERVICE_CATEGORIES.map((item) => <div className="service-card" key={item.value}><span className={`service-card__icon service-card__icon--${item.value}`}><ServiceIcon category={item.value} /></span><strong>{item.label}</strong><p>Available in the listed service areas.</p></div>)}</div>
        <section className="dashboard-section">
          <div className="section-heading"><div><p className="eyebrow">VERIFIED ARTISANS</p><h2>Choose an artisan</h2></div><Search size={18} color="#5d8a72" /></div>
          <div className="filter-row">
            <Field label="Service"><select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as ServiceCategory | '')}><option value="">All pilot services</option>{SERVICE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <Field label="Service zone"><select value={filterZone} onChange={(event) => setFilterZone(event.target.value)}><option value="">All active zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></Field>
          </div>
          {visibleArtisans.length ? <div className="section-grid">{visibleArtisans.map((artisan) => <Card key={artisan.user_id} className="card-pad artisan-list-card">
            <div className="list-card__top"><div><h3>{artisan.display_name || 'Verified artisan'}</h3><div className="service-tags">{artisan.service_categories.map((category) => <span className="tag" key={category}>{serviceLabel(category)}</span>)}</div></div><StatusPill status={artisan.is_available ? 'available' : 'not taking requests'} /></div>
            {artisan.bio && <p className="list-card__body artisan-list-card__bio">{artisan.bio}</p>}
            <Button variant="secondary" onClick={() => { setProfileArtisan(artisan); setActiveTab('artisan-profile'); }}>View profile</Button>
          </Card>)}</div> : loadError ? <EmptyState title="Artisan results could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no providers." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title="No verified artisans match these filters" detail="Try a different service zone or category, or post a matching request for eligible artisans." />}
        </section>
        <section id="request-form" className="dashboard-section customer-request-layout">
          <Card className="request-form-card">
            <div className="card-heading"><div><p className="eyebrow">MATCHING REQUEST</p><h2>Find an available artisan</h2><p>Eligible artisans can respond based on your service and zone.</p></div><span className="service-card__icon"><ClipboardList size={19} /></span></div>
            <form className="form-stack" onSubmit={(event) => void createRequest(event)}>
              <Field label="Service category"><select required value={requestCategory} onChange={(event) => setRequestCategory(event.target.value as ServiceCategory)}>{SERVICE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
              <Field label="Service zone"><select required value={requestZone} onChange={(event) => setRequestZone(event.target.value)}><option value="">Choose one zone</option>{groupedZones.map(([group, items]) => <optgroup key={group} label={group}>{items.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</optgroup>)}</select></Field>
              <Field label="Short title"><input required minLength={3} maxLength={100} value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="e.g. Repair a desk lamp" /></Field>
              <Field label="Describe the work"><textarea required minLength={10} maxLength={2500} value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="Include useful details and where to meet in this zone." /></Field>
              <Field label="Reference photos (optional)" hint={`JPG or PNG · up to ${MAX_IMAGES} photos · 8 MB each`}><input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => { setRequestFiles(Array.from(event.target.files ?? [])); setError(''); }} /></Field>
              {requestFiles.length > 0 && <p className="field__hint">{requestFiles.length} photo{requestFiles.length === 1 ? '' : 's'} selected.</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Posting request…' : 'Post matching request'}</Button>
            </form>
          </Card>
          <div className="request-side-note"><div className="service-card__icon"><CalendarDays size={19} /></div><h3>What happens next</h3><p>Real offers appear here. Choose one to confirm work and start its conversation.</p></div>
        </section>
      </>}

      {activeTab === 'requests' && <>
        <AppHeader eyebrow="YOUR SERVICE ACTIVITY" title="Requests & job history" detail="Review offers, job status, conversations, and the activity timeline for each request." action={<Button onClick={() => setActiveTab('discover')}>New request</Button>} />
        {!requests.length ? loadError ? <EmptyState title="Your requests could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no saved requests." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title="No service requests yet" detail="Your posted matching and direct requests will appear here." action={<Button onClick={() => setActiveTab('discover')}>Browse services</Button>} /> : <div className="list-stack">{requests.map((request) => {
          const requestOffers = offers.filter((offer) => offer.request_id === request.id);
          const acceptedOffer = requestOffers.find((offer) => offer.status === 'accepted');
          const review = reviews.find((item) => item.request_id === request.id);
          return <Card key={request.id} className="card-pad request-card">
            <div className="list-card__top"><div><p className="eyebrow">{serviceLabel(request.service_category)} · {request.target_artisan_id ? 'Direct request' : zoneName(request.zone_id)}</p><h3>{request.title}</h3></div><StatusPill status={request.status} /></div>
            {request.target_artisan_id && <p className="field__hint">Sent directly to {artisans.find((item) => item.user_id === request.target_artisan_id)?.display_name || artisanNames[request.target_artisan_id] || 'your selected artisan'}.</p>}
            <p className="list-card__body">{request.description}</p>
            <div className="list-card__meta"><span><CalendarDays size={14} /> {formatDate(request.created_at)}</span><span>{requestOffers.length} {requestOffers.length === 1 ? 'offer' : 'offers'}</span></div>
            <RequestAttachments supabase={supabase} requestId={request.id} refreshRevision={attachmentRevision} />
            {!!requestOffers.length && <div className="offer-list">{requestOffers.map((offer) => <div className="offer-card" key={offer.id}>
              <div className="list-card__top"><div><strong>{artisanNames[offer.artisan_id] ?? 'Verified artisan'}</strong><p className="field__hint">{formatNaira(offer.quote_ngn)} · {formatDate(offer.created_at)}</p></div><StatusPill status={offer.status} /></div>
              <p className="list-card__body">{offer.message}</p>
              {request.status === 'open' && offer.status === 'pending' && <div className="list-card__actions"><Button disabled={busy} onClick={() => void respondToOffer(offer.id, true)}><CheckCheck size={15} /> Accept offer</Button><Button variant="quiet" disabled={busy} onClick={() => void respondToOffer(offer.id, false)}>Decline</Button></div>}
              {request.status !== 'cancelled' && <div className="list-card__actions"><ComplaintForm supabase={supabase} requestId={request.id} reporterId={profile.id} subjectUserId={offer.artisan_id} /></div>}
            </div>)}</div>}
            {request.status === 'open' && <div className="list-card__actions"><Button variant="quiet" disabled={busy} onClick={() => void updateRequestStatus(request.id, 'cancel')}>Cancel request</Button></div>}
            {request.status === 'accepted' && <div className="list-card__actions"><Button variant="secondary" disabled={busy} onClick={() => void updateRequestStatus(request.id, 'complete')}>Mark work complete</Button></div>}
            {request.status === 'completed' && acceptedOffer && (loadError ? <Alert>A live query failed; retry before submitting a review.</Alert> : review ? <Alert tone="success">Your review was submitted for this completed request.</Alert> : <div className="review-wrap"><div className="section-kicker">Share a review</div><ReviewForm supabase={supabase} requestId={request.id} customerId={profile.id} artisanId={acceptedOffer.artisan_id} onSaved={() => void loadData()} /></div>)}
            <RequestHistory events={requestEvents.filter((item) => item.request_id === request.id)} />
          </Card>;
        })}</div>}
      </>}

      {activeTab === 'messages' && <>
        <AppHeader eyebrow="PRIVATE CONVERSATIONS" title="Messages" detail="Fresh conversations and request status load whenever you open this section." />
        <MessagesPanel supabase={supabase} userId={profile.id} conversations={conversations} />
      </>}

      {activeTab === 'account' && <>
        <AppHeader eyebrow="ACCOUNT & PRIVACY" title="Your account" detail="Your contact information stays private and is visible to you and authorized FixMate administrators." />
        <div className="section-grid">
          <Card className="card-pad"><div className="card-heading"><div><p className="eyebrow">PROFILE</p><h2>Contact details</h2><p>Email: {profile.email || 'Not available'}</p></div><span className="service-card__icon"><Settings2 size={19} /></span></div>
            <form className="form-stack" onSubmit={(event) => void saveAccount(event)}><Field label="Name"><input required maxLength={120} value={accountName} onChange={(event) => setAccountName(event.target.value)} /></Field><Field label="WhatsApp number" hint="Used for account contact only; not your login method."><input required type="tel" value={accountPhone} onChange={(event) => setAccountPhone(event.target.value)} /></Field>{accountSaved && <Alert tone="success">Your private contact details were saved.</Alert>}<Button type="submit" disabled={busy}>Save details</Button></form>
          </Card>
          <Card className="card-pad"><p className="eyebrow">FIXMATE SUPPORT</p><h2>Need help?</h2><p className="muted">Contact the FixMate administrator through the configured WhatsApp support line. The link opens a draft; it does not send automatically.</p><WhatsAppSupport supabase={supabase} /><div className="privacy-notice"><Star size={17} /><p>Student ID or an alternative government ID is reviewed privately. NIN is one optional alternative, not a requirement for everyone.</p></div><Button variant="quiet" onClick={onSignOut}>Sign out</Button></Card>
        </div>
      </>}
    </WorkspaceShell>
  );
}
