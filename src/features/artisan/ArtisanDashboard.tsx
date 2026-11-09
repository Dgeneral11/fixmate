import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, CheckCheck, ClipboardList, MessageSquareText, Send, Settings2, UserRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { Alert, AppHeader, Button, Card, EmptyState, Field, LoadingState, ServiceIcon, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { cleanWhatsAppNumber, formatDate, formatNaira, groupZones, SERVICE_CATEGORIES, serviceLabel } from '../../lib/catalog';
import type { ArtisanOffer, ArtisanProfile, CustomerRequest, FixmateRequestEvent, Profile, ServiceCategory, ServiceZone } from '../../lib/types';
import { ComplaintForm } from '../shared/ComplaintForm';
import { MessagesPanel, type ConversationRef } from '../shared/MessagesPanel';
import { RequestAttachments } from '../shared/RequestAttachments';
import { RequestHistory } from '../shared/RequestHistory';
import { ArtisanPortfolioManager } from './ArtisanPortfolioManager';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

type ArtisanTab = 'requests' | 'offers' | 'messages' | 'profile';
const navItems: ReadonlyArray<WorkspaceNavItem<ArtisanTab>> = [
  { id: 'requests', label: 'Requests', icon: ClipboardList },
  { id: 'offers', label: 'My offers', icon: BriefcaseBusiness },
  { id: 'messages', label: 'Messages', icon: MessageSquareText },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

export function ArtisanDashboard({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [activeTab, setActiveTab] = useState<ArtisanTab>('requests');
  const [artisan, setArtisan] = useState<ArtisanProfile | null>(null);
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [offers, setOffers] = useState<ArtisanOffer[]>([]);
  const [offerRequests, setOfferRequests] = useState<CustomerRequest[]>([]);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [requestEvents, setRequestEvents] = useState<FixmateRequestEvent[]>([]);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [years, setYears] = useState('');
  const [bio, setBio] = useState('');
  const [offerDrafts, setOfferDrafts] = useState<Record<string, { quote: string; message: string }>>({});
  const loadGeneration = useRef(0);

  async function loadData(background = false) {
    const generation = ++loadGeneration.current;
    if (!background) setLoading(true);
    setError(''); setLoadError('');
    const [artisanResult, zonesResult, zoneLinksResult, requestResult, offerResult] = await Promise.all([
      supabase.from('artisan_profiles').select('user_id, display_name, service_categories, years_experience, service_area, bio, is_available').eq('user_id', profile.id).maybeSingle(),
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').eq('is_active', true).order('sort_order'),
      supabase.from('artisan_service_zones').select('zone_id').eq('artisan_id', profile.id),
      supabase.from('customer_requests').select('id, customer_id, target_artisan_id, service_category, zone_id, title, description, status, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(80),
      supabase.from('artisan_offers').select('id, request_id, artisan_id, quote_ngn, message, status, created_at').eq('artisan_id', profile.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const firstError = artisanResult.error ?? zonesResult.error ?? zoneLinksResult.error ?? requestResult.error ?? offerResult.error;
    if (firstError && background) {
      if (generation === loadGeneration.current) { setLoadError(firstError.message); setLoading(false); }
      return;
    }
    if (firstError) setLoadError(firstError.message);
    const artisanData = artisanResult.data as ArtisanProfile | null;
    const offerData = (offerResult.data ?? []) as ArtisanOffer[];
    const requestData = (requestResult.data ?? []) as CustomerRequest[];
    if (generation !== loadGeneration.current) return;
    setArtisan(artisanData);
    setZones((zonesResult.data ?? []) as ServiceZone[]);
    if (!background || activeTab !== 'profile') setSelectedZones((zoneLinksResult.data ?? []).map((item: { zone_id: string }) => item.zone_id));
    setRequests(requestData);
    setOffers(offerData);
    if (artisanData && (!background || activeTab !== 'profile')) {
      setDisplayName(artisanData.display_name || profile.display_name);
      setCategories(artisanData.service_categories ?? []);
      setYears(artisanData.years_experience == null ? '' : String(artisanData.years_experience));
      setBio(artisanData.bio ?? '');
    }

    const requestIds = [...new Set([...requestData.map((item) => item.id), ...offerData.map((offer) => offer.request_id)])];
    let nextOfferRequests: CustomerRequest[] = [];
    const nextEvents: FixmateRequestEvent[] = [];
    if (requestIds.length) {
      const [offeredRequestsResult, eventResult] = await Promise.all([
        supabase.from('customer_requests').select('id, customer_id, target_artisan_id, service_category, zone_id, title, description, status, created_at')
          .in('id', [...new Set(offerData.map((offer) => offer.request_id))]).order('created_at', { ascending: false }).limit(100),
        supabase.from('fixmate_request_events').select('id, request_id, actor_id, event_type, details, created_at')
          .in('request_id', requestIds).order('created_at', { ascending: true }).limit(1500),
      ]);
      const relatedError = offeredRequestsResult.error ?? eventResult.error;
      if (relatedError && background) {
        if (generation === loadGeneration.current) { setLoadError(relatedError.message); setLoading(false); }
        return;
      }
      if (offeredRequestsResult.error) setLoadError(offeredRequestsResult.error.message);
      else nextOfferRequests = (offeredRequestsResult.data ?? []) as CustomerRequest[];
      if (eventResult.error) setLoadError(eventResult.error.message);
      else nextEvents.push(...((eventResult.data ?? []) as FixmateRequestEvent[]));
    }
    if (generation !== loadGeneration.current) return;
    const nextActiveCount = offerData.filter((offer) => offer.status === 'accepted' && nextOfferRequests.some((request) => request.id === offer.request_id && request.status === 'accepted')).length;
    setOfferRequests(nextOfferRequests);
    setRequestEvents(nextEvents);
    setActiveJobCount(nextActiveCount);
    setLoading(false);
  }

  const liveStatus = useRealtimeRefresh({
    supabase,
    identity: profile.id,
    scope: 'artisan-dashboard',
    tables: [
      { table: 'customer_requests' },
      { table: 'artisan_offers', filter: `artisan_id=eq.${profile.id}` },
      { table: 'fixmate_request_events' },
      { table: 'artisan_profiles', filter: `user_id=eq.${profile.id}` },
      { table: 'artisan_service_zones', filter: `artisan_id=eq.${profile.id}` },
      { table: 'pilot_service_zones' },
    ],
    onChange: () => loadData(true),
  });
  useRealtimeRefresh({
    supabase,
    identity: profile.id,
    scope: 'artisan-request-attachments',
    tables: [{ table: 'customer_request_attachments' }],
    onChange: () => setAttachmentRevision((revision) => revision + 1),
  });

  useEffect(() => { void loadData(); }, [profile.id]);
  useEffect(() => { if (activeTab === 'messages') void loadData(true); }, [activeTab, profile.id]);

  const groupedZones = useMemo(() => groupZones(zones), [zones]);
  const zoneName = (id: string) => zones.find((zone) => zone.id === id)?.name ?? 'Service area';
  const conversations: ConversationRef[] = offers.map((offer) => {
    const request = offerRequests.find((item) => item.id === offer.request_id);
    return { offerId: offer.id, requestId: offer.request_id, requestTitle: request?.title ?? 'Service request', otherName: 'Customer', status: offer.status };
  });

  function toggleCategory(category: ServiceCategory) {
    setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }
  function toggleZone(zoneId: string) {
    setSelectedZones((current) => current.includes(zoneId) ? current.filter((id) => id !== zoneId) : [...current, zoneId]);
  }

  async function submitOffer(event: FormEvent<HTMLFormElement>, request: CustomerRequest) {
    event.preventDefault(); setError('');
    const draft = offerDrafts[request.id] ?? { quote: '', message: '' };
    setBusy(true);
    const { error: insertError } = await supabase.from('artisan_offers').insert({
      request_id: request.id, artisan_id: profile.id,
      quote_ngn: draft.quote.trim() ? Number(draft.quote) : null,
      message: draft.message.trim(), status: 'pending',
    });
    if (insertError) setError(insertError.message);
    else { setOfferDrafts((current) => ({ ...current, [request.id]: { quote: '', message: '' } })); await loadData(); }
    setBusy(false);
  }

  async function markComplete(requestId: string) {
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('fixmate_complete_request', { p_request_id: requestId });
    if (rpcError) setError(rpcError.message);
    else await loadData();
    setBusy(false);
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setProfileSaved(false);
    const cleanPhoneValue = cleanWhatsAppNumber(phone);
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhoneValue)) { setError('Enter a WhatsApp contact number with 10–15 digits.'); return; }
    if (!categories.length) { setError('Select at least one approved pilot service.'); return; }
    if (!selectedZones.length) { setError('Select at least one service zone.'); return; }
    setBusy(true);
    const { error: contactError } = await supabase.from('profiles').update({ display_name: displayName.trim(), phone: cleanPhoneValue }).eq('id', profile.id);
    if (contactError) { setError(contactError.message); setBusy(false); return; }
    const { error: artisanError } = await supabase.from('artisan_profiles').update({
      display_name: displayName.trim(), service_categories: categories,
      years_experience: years.trim() ? Number(years) : null, bio: bio.trim() || null,
    }).eq('user_id', profile.id);
    if (artisanError) { setError(artisanError.message); setBusy(false); return; }
    const { error: deleteError } = await supabase.from('artisan_service_zones').delete().eq('artisan_id', profile.id);
    if (deleteError) { setError(deleteError.message); setBusy(false); return; }
    const { error: zoneError } = await supabase.from('artisan_service_zones').insert(selectedZones.map((zone_id) => ({ artisan_id: profile.id, zone_id })));
    if (zoneError) setError(zoneError.message);
    else { setProfileSaved(true); await loadData(); await onRefresh(); }
    setBusy(false);
  }

  async function toggleAvailability() {
    if (!artisan) return;
    setBusy(true); setError('');
    const { error: updateError } = await supabase.from('artisan_profiles').update({ is_available: !artisan.is_available }).eq('user_id', profile.id);
    if (updateError) setError(updateError.message);
    else await loadData();
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading your verified artisan workspace…" />;
  if (!artisan) return <div className="setup-screen"><Card className="card-pad"><Alert>{loadError || 'The artisan profile could not be found. Sign out and sign in again, or contact FixMate support.'}</Alert><div className="button-row"><Button variant="secondary" onClick={() => void loadData()}>Retry</Button><WhatsAppSupport supabase={supabase} /></div></Card></div>;

  return (
    <WorkspaceShell profile={profile} roleLabel="FixMate-verified artisan" navItems={navItems} activeTab={activeTab} liveStatus={liveStatus} onTabChange={setActiveTab} onSignOut={onSignOut}>
      {error && <Alert>{error}</Alert>}{loadError && <Alert>{loadError}</Alert>}
      {activeTab === 'requests' && <>
        <AppHeader eyebrow="REQUESTS FOR YOUR SERVICES" title="Service requests" detail={artisan.is_available ? 'Direct requests are sent only to you. Matching requests depend on your approved category and service zone.' : 'Your profile is paused; turn availability on to receive requests.'} action={<Button variant={artisan.is_available ? 'secondary' : 'primary'} disabled={busy} onClick={() => void toggleAvailability()}>{artisan.is_available ? 'Pause availability' : 'Go available'}</Button>} />
        <div className="metric-row"><Card className="metric-card"><div className="metric-card__value">{activeJobCount}/2</div><div className="metric-card__label">Accepted unfinished jobs · limit 2</div></Card></div>
        {!artisan.is_available && <Alert tone="info">Your availability is paused. Turn it on when you are ready to receive new requests.</Alert>}
        {requests.length ? <div className="list-stack">{requests.map((request) => {
          const alreadyOffered = offers.some((offer) => offer.request_id === request.id);
          const isDirect = request.target_artisan_id === profile.id;
          return <Card key={request.id} className="card-pad"><div className="list-card__top"><div className="request-heading"><span className={`service-card__icon service-card__icon--${request.service_category}`}><ServiceIcon category={request.service_category} /></span><div><p className="eyebrow">{isDirect ? 'DIRECT REQUEST FOR YOU' : 'MATCHING REQUEST'} · {serviceLabel(request.service_category)} · {zoneName(request.zone_id)}</p><h3>{request.title}</h3></div></div><StatusPill status={request.status} /></div><p className="list-card__body">{request.description}</p><div className="list-card__meta"><span>{formatDate(request.created_at)}</span></div>
            <RequestAttachments supabase={supabase} requestId={request.id} refreshRevision={attachmentRevision} />
            {alreadyOffered ? <Alert tone="info">You have already responded to this request. Track your offer under “My offers”.</Alert> : !artisan.is_available ? <Alert tone="info">Turn on availability before sending an offer.</Alert> : <form className="offer-form" onSubmit={(event) => void submitOffer(event, request)}><div className="form-grid"><Field label="Your quote in NGN" hint="Optional"><input type="number" min="1" max="100000000" value={offerDrafts[request.id]?.quote ?? ''} onChange={(event) => setOfferDrafts((current) => ({ ...current, [request.id]: { quote: event.target.value, message: current[request.id]?.message ?? '' } }))} placeholder="Optional" /></Field><Field label="Message to the customer"><input required minLength={3} maxLength={1200} value={offerDrafts[request.id]?.message ?? ''} onChange={(event) => setOfferDrafts((current) => ({ ...current, [request.id]: { quote: current[request.id]?.quote ?? '', message: event.target.value } }))} placeholder="Briefly explain how you can help" /></Field></div><Button type="submit" disabled={busy}><Send size={15} /> Send offer</Button></form>}
            <RequestHistory events={requestEvents.filter((item) => item.request_id === request.id)} />
          </Card>;
        })}</div> : loadError ? <EmptyState title="Service requests could not be confirmed" detail="A live FixMate query failed. Retry before assuming your queue is empty." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title={artisan.is_available ? 'No requests are available yet' : 'Turn on availability to receive requests'} detail={artisan.is_available ? 'Matching requests need an approved service category and active zone. Errands appear when Errands is selected on your profile. Direct requests are sent only to the artisan selected by the customer.' : 'When available, matching requests still use your approved categories and zones; direct requests are addressed to you specifically.'} action={!artisan.is_available ? <Button onClick={() => void toggleAvailability()} disabled={busy}>Go available</Button> : undefined} />}
      </>}

      {activeTab === 'offers' && <>
        <AppHeader eyebrow="YOUR RESPONSES" title="My offers & job history" detail="Follow offer status and the full activity timeline for each request." />
        <div className="metric-row"><Card className="metric-card"><div className="metric-card__value">{activeJobCount}/2</div><div className="metric-card__label">Accepted unfinished jobs · limit 2</div></Card></div>
        {!offers.length ? loadError ? <EmptyState title="Your offers could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no saved offers." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title="No offers sent yet" detail="Offers you send to FixMate requests will appear here." /> : <div className="list-stack">{offers.map((offer) => {
          const request = offerRequests.find((item) => item.id === offer.request_id);
          return <Card key={offer.id} className="card-pad"><div className="list-card__top"><div><p className="eyebrow">{request ? serviceLabel(request.service_category) : 'Service request'} · {request?.target_artisan_id ? 'Direct request' : request ? zoneName(request.zone_id) : 'Service request'}</p><h3>{request?.title ?? 'Service request'}</h3></div><StatusPill status={offer.status} /></div><p className="list-card__body">{offer.message}</p><div className="list-card__meta"><span>{formatNaira(offer.quote_ngn)}</span><span>{formatDate(offer.created_at)}</span></div>{request && <RequestAttachments supabase={supabase} requestId={request.id} refreshRevision={attachmentRevision} />}{request && offer.status === 'accepted' && request.status === 'accepted' && <div className="list-card__actions"><Button variant="secondary" disabled={busy} onClick={() => void markComplete(request.id)}><CheckCheck size={15} /> Mark work complete</Button><ComplaintForm supabase={supabase} requestId={request.id} reporterId={profile.id} subjectUserId={request.customer_id} /></div>}{offer.status === 'accepted' && request?.status === 'completed' && <Alert tone="success">This job is complete.</Alert>}{request && <RequestHistory events={requestEvents.filter((item) => item.request_id === request.id)} />}</Card>;
        })}</div>}
      </>}

      {activeTab === 'messages' && <>
        <AppHeader eyebrow="PRIVATE CONVERSATIONS" title="Messages" detail="Your latest offers, messages, and request status are refreshed when you open this section." />
        <MessagesPanel supabase={supabase} userId={profile.id} conversations={conversations} />
      </>}

      {activeTab === 'profile' && <>
        <AppHeader eyebrow="VERIFIED PROVIDER PROFILE" title="Your profile & availability" detail="Name, approved services, or description changes need administrator review. Service zones remain private and are used for matching." action={<StatusPill status="approved" />} />
        <div className="section-grid">
          <Card className="card-pad"><div className="card-heading"><div><p className="eyebrow">PROFILE DETAILS</p><h2>What customers see</h2></div><span className="service-card__icon"><Settings2 size={19} /></span></div>
            <form className="form-stack" onSubmit={(event) => void updateProfile(event)}><Field label="Display name"><input required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field><Field label="WhatsApp contact" hint="Private contact detail; customers do not see this number."><input required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="Service categories"><div className="checkbox-list">{SERVICE_CATEGORIES.map((item) => <label key={item.value} className="checkbox-option"><input type="checkbox" checked={categories.includes(item.value)} onChange={() => toggleCategory(item.value)} /><span>{item.label}</span></label>)}</div></Field><Field label="Private service zones used for matching"><div>{groupedZones.map(([group, items]) => <div className="zone-checkbox-group" key={group}><h4>{group}</h4><div className="zone-grid">{items.map((zone) => <label key={zone.id} className="zone-option"><input type="checkbox" checked={selectedZones.includes(zone.id)} onChange={() => toggleZone(zone.id)} /><span>{zone.name}</span></label>)}</div></div>)}</div></Field><Field label="About your work" hint="Keep this short; customers see it on your profile."><textarea maxLength={1200} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Describe your services and experience." /></Field>{profileSaved && <Alert tone="success">Your profile changes were saved.</Alert>}<Button type="submit" disabled={busy}>Save profile</Button></form>
          </Card>
          <div className="form-stack"><Card className="card-pad"><p className="eyebrow">AVAILABILITY</p><h2>{artisan.is_available ? 'You are taking requests' : 'Your requests are paused'}</h2><p className="muted">Availability controls whether you receive new requests and may send offers. Turning it off does not remove your verification.</p><Button variant={artisan.is_available ? 'secondary' : 'primary'} disabled={busy} onClick={() => void toggleAvailability()}>{artisan.is_available ? 'Pause requests' : 'Go available'}</Button><p className="field__hint">You can accept no more than two unfinished jobs at a time. Your current count is {activeJobCount}.</p></Card><Card className="card-pad"><p className="eyebrow">FIXMATE SUPPORT</p><h2>Need help?</h2><p className="muted">Do not send identity or qualification documents in chat.</p><WhatsAppSupport supabase={supabase} /></Card></div>
        </div>
        <ArtisanPortfolioManager supabase={supabase} artisanId={profile.id} />
      </>}
    </WorkspaceShell>
  );
}
