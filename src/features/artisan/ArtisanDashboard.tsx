import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, CheckCheck, ClipboardList, MessageSquareText, Send, Settings2, UserRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { Alert, AppHeader, Button, Card, EmptyState, Field, LoadingState, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { cleanWhatsAppNumber, formatDate, formatNaira, groupZones, SERVICE_CATEGORIES, serviceLabel } from '../../lib/catalog';
import type { ArtisanOffer, ArtisanProfile, CustomerRequest, Profile, ServiceCategory, ServiceZone } from '../../lib/types';
import { ComplaintForm } from '../shared/ComplaintForm';
import { MessagesPanel, type ConversationRef } from '../shared/MessagesPanel';

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

  async function loadData() {
    setLoading(true);
    setError('');
    setLoadError('');
    const [artisanResult, zonesResult, zoneLinksResult, requestResult, offerResult] = await Promise.all([
      supabase.from('artisan_profiles').select('user_id, display_name, service_categories, years_experience, service_area, bio, is_available').eq('user_id', profile.id).maybeSingle(),
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').eq('is_active', true).order('sort_order'),
      supabase.from('artisan_service_zones').select('zone_id').eq('artisan_id', profile.id),
      supabase.from('customer_requests').select('id, customer_id, service_category, zone_id, title, description, status, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(80),
      supabase.from('artisan_offers').select('id, request_id, artisan_id, quote_ngn, message, status, created_at').eq('artisan_id', profile.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const firstError = artisanResult.error ?? zonesResult.error ?? zoneLinksResult.error ?? requestResult.error ?? offerResult.error;
    if (firstError) setLoadError(firstError.message);
    const artisanData = artisanResult.data as ArtisanProfile | null;
    const offerData = (offerResult.data ?? []) as ArtisanOffer[];
    setArtisan(artisanData);
    setZones((zonesResult.data ?? []) as ServiceZone[]);
    setSelectedZones((zoneLinksResult.data ?? []).map((item: { zone_id: string }) => item.zone_id));
    setRequests((requestResult.data ?? []) as CustomerRequest[]);
    setOffers(offerData);
    if (artisanData) {
      setDisplayName(artisanData.display_name || profile.display_name);
      setCategories(artisanData.service_categories ?? []);
      setYears(artisanData.years_experience == null ? '' : String(artisanData.years_experience));
      setBio(artisanData.bio ?? '');
    }
    const requestIds = [...new Set(offerData.map((offer) => offer.request_id))];
    if (requestIds.length) {
      const { data: offeredRequests, error: offeredRequestError } = await supabase.from('customer_requests')
        .select('id, customer_id, service_category, zone_id, title, description, status, created_at')
        .in('id', requestIds).order('created_at', { ascending: false });
      if (offeredRequestError) setLoadError(offeredRequestError.message);
      setOfferRequests((offeredRequests ?? []) as CustomerRequest[]);
    } else setOfferRequests([]);
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, [profile.id]);

  const groupedZones = useMemo(() => groupZones(zones), [zones]);
  const zoneName = (id: string) => zones.find((zone) => zone.id === id)?.name ?? 'ABU Main Campus zone';
  const conversations: ConversationRef[] = offers.map((offer) => {
    const request = offerRequests.find((item) => item.id === offer.request_id);
    return {
      offerId: offer.id,
      requestId: offer.request_id,
      requestTitle: request?.title ?? 'Service request',
      otherName: 'Customer',
      status: offer.status,
    };
  });

  function toggleCategory(category: ServiceCategory) {
    setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }
  function toggleZone(zoneId: string) {
    setSelectedZones((current) => current.includes(zoneId) ? current.filter((id) => id !== zoneId) : [...current, zoneId]);
  }

  async function submitOffer(event: FormEvent<HTMLFormElement>, request: CustomerRequest) {
    event.preventDefault();
    setError('');
    const draft = offerDrafts[request.id] ?? { quote: '', message: '' };
    setBusy(true);
    const { error: insertError } = await supabase.from('artisan_offers').insert({
      request_id: request.id,
      artisan_id: profile.id,
      quote_ngn: draft.quote.trim() ? Number(draft.quote) : null,
      message: draft.message.trim(),
      status: 'pending',
    });
    if (insertError) setError(insertError.message);
    else {
      setOfferDrafts((current) => ({ ...current, [request.id]: { quote: '', message: '' } }));
      await loadData();
    }
    setBusy(false);
  }

  async function markComplete(requestId: string) {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('fixmate_complete_request', { p_request_id: requestId });
    if (rpcError) setError(rpcError.message);
    else await loadData();
    setBusy(false);
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setProfileSaved(false);
    const cleanPhoneValue = cleanWhatsAppNumber(phone);
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhoneValue)) { setError('Enter a WhatsApp contact number with 10–15 digits.'); return; }
    if (!categories.length) { setError('Select at least one active pilot service.'); return; }
    if (!selectedZones.length) { setError('Select at least one ABU Main Campus service zone.'); return; }
    setBusy(true);
    const { error: contactError } = await supabase.from('profiles').update({ display_name: displayName.trim(), phone: cleanPhoneValue }).eq('id', profile.id);
    if (contactError) { setError(contactError.message); setBusy(false); return; }
    const { error: artisanError } = await supabase.from('artisan_profiles').update({
      display_name: displayName.trim(),
      service_categories: categories,
      years_experience: years.trim() ? Number(years) : null,
      bio: bio.trim() || null,
    }).eq('user_id', profile.id);
    if (artisanError) { setError(artisanError.message); setBusy(false); return; }
    const { error: deleteError } = await supabase.from('artisan_service_zones').delete().eq('artisan_id', profile.id);
    if (deleteError) { setError(deleteError.message); setBusy(false); return; }
    const { error: zoneError } = await supabase.from('artisan_service_zones').insert(selectedZones.map((zone_id) => ({ artisan_id: profile.id, zone_id })));
    if (zoneError) setError(zoneError.message);
    else {
      setProfileSaved(true);
      await loadData();
      await onRefresh();
    }
    setBusy(false);
  }

  async function toggleAvailability() {
    if (!artisan) return;
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.from('artisan_profiles').update({ is_available: !artisan.is_available }).eq('user_id', profile.id);
    if (updateError) setError(updateError.message);
    else await loadData();
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading your verified artisan workspace…" />;
  if (!artisan) return <div className="setup-screen"><Card className="card-pad"><Alert>{loadError || 'The artisan profile could not be found. Sign out and sign in again, or contact FixMate support.'}</Alert><div className="button-row"><Button variant="secondary" onClick={() => void loadData()}>Retry</Button><WhatsAppSupport supabase={supabase} /></div></Card></div>;

  return (
    <WorkspaceShell profile={profile} roleLabel="FixMate-verified artisan" navItems={navItems} activeTab={activeTab} onTabChange={setActiveTab} onSignOut={onSignOut}>
      {error && <Alert>{error}</Alert>}{loadError && <Alert>{loadError}</Alert>}
      {activeTab === 'requests' && <>
        <AppHeader eyebrow="MATCHED TO YOUR SERVICES & ZONES" title="Service requests" detail="Only open requests matching your approved categories, active service zones, and availability appear here." action={<Button variant={artisan.is_available ? 'secondary' : 'primary'} disabled={busy} onClick={() => void toggleAvailability()}>{artisan.is_available ? 'Pause availability' : 'Go available'}</Button>} />
        {!artisan.is_available && <Alert tone="info">Your availability is paused. Turn it on when you are ready to receive matching requests.</Alert>}
        {requests.length ? <div className="list-stack">{requests.map((request) => {
          const alreadyOffered = offers.some((offer) => offer.request_id === request.id);
          return <Card key={request.id} className="card-pad"><div className="list-card__top"><div><p className="eyebrow">{serviceLabel(request.service_category)} · {zoneName(request.zone_id)}</p><h3>{request.title}</h3></div><StatusPill status={request.status} /></div><p className="list-card__body">{request.description}</p><div className="list-card__meta"><span>{formatDate(request.created_at)}</span><span>Customer WhatsApp numbers stay private; use request messages to discuss details.</span></div>
            {alreadyOffered ? <Alert tone="info">You have already responded to this request. Track your offer under “My offers”.</Alert> : <form className="offer-form" onSubmit={(event) => void submitOffer(event, request)}><div className="form-grid"><Field label="Your quote in NGN" hint="Optional"><input type="number" min="1" max="100000000" value={offerDrafts[request.id]?.quote ?? ''} onChange={(event) => setOfferDrafts((current) => ({ ...current, [request.id]: { quote: event.target.value, message: current[request.id]?.message ?? '' } }))} placeholder="Optional" /></Field><Field label="Message to the customer" hint="Keep contact numbers private; continue through FixMate messages after your offer."><input required minLength={3} maxLength={1200} value={offerDrafts[request.id]?.message ?? ''} onChange={(event) => setOfferDrafts((current) => ({ ...current, [request.id]: { quote: current[request.id]?.quote ?? '', message: event.target.value } }))} placeholder="Briefly explain how you can help" /></Field></div><Button type="submit" disabled={busy}><Send size={15} /> Send offer</Button></form>}
          </Card>;
        })}</div> : loadError ? <EmptyState title="Matching requests could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no matching requests." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title={artisan.is_available ? 'No matching requests right now' : 'Turn on availability to see requests'} detail={artisan.is_available ? 'New customer requests will appear when they match your FixMate-approved services and ABU Main Campus zones.' : 'Matching is controlled by your availability, approved profile, service categories, and campus zones.'} action={!artisan.is_available ? <Button onClick={() => void toggleAvailability()} disabled={busy}>Go available</Button> : undefined} />}
      </>}

      {activeTab === 'offers' && <>
        <AppHeader eyebrow="YOUR RESPONSES" title="My offers" detail="Follow offer status and continue only in the conversation attached to each real request." />
        {!offers.length ? loadError ? <EmptyState title="Your offers could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no saved offers." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title="No offers sent yet" detail="Offers you send to matching FixMate service requests will appear here." /> : <div className="list-stack">{offers.map((offer) => {
          const request = offerRequests.find((item) => item.id === offer.request_id);
          return <Card key={offer.id} className="card-pad"><div className="list-card__top"><div><p className="eyebrow">{request ? serviceLabel(request.service_category) : 'Service request'} · {request ? zoneName(request.zone_id) : 'ABU Main Campus'}</p><h3>{request?.title ?? 'Service request'}</h3></div><StatusPill status={offer.status} /></div><p className="list-card__body">{offer.message}</p><div className="list-card__meta"><span>{formatNaira(offer.quote_ngn)}</span><span>{formatDate(offer.created_at)}</span></div>{offer.status === 'accepted' && request?.status === 'accepted' && <div className="list-card__actions"><Button variant="secondary" disabled={busy} onClick={() => void markComplete(request.id)}><CheckCheck size={15} /> Mark work complete</Button><ComplaintForm supabase={supabase} requestId={request.id} reporterId={profile.id} subjectUserId={request.customer_id} /></div>}{offer.status === 'accepted' && request?.status === 'completed' && <Alert tone="success">The customer or artisan marked this request complete.</Alert>}</Card>;
        })}</div>}
      </>}

      {activeTab === 'messages' && <>
        <AppHeader eyebrow="PRIVATE CONVERSATIONS" title="Messages" detail="Talk with customers only in conversations tied to your FixMate offers." />
        <MessagesPanel supabase={supabase} userId={profile.id} conversations={conversations} />
      </>}

      {activeTab === 'profile' && <>
        <AppHeader eyebrow="VERIFIED PROVIDER PROFILE" title="Your profile & availability" detail="Changes to your name, service categories, or bio trigger administrator review and pause marketplace access. Zone and availability changes apply to matching." action={<StatusPill status="approved" />} />
        <div className="section-grid">
          <Card className="card-pad"><div className="card-heading"><div><p className="eyebrow">PROFILE DETAILS</p><h2>What customers see</h2><p>Email: {profile.email || 'Not available'}</p></div><span className="service-card__icon"><Settings2 size={19} /></span></div>
            <form className="form-stack" onSubmit={updateProfile}><Field label="Display name"><input required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field><Field label="WhatsApp contact" hint="Private contact detail; customers do not see this number."><input required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="FixMate pilot services"><div className="checkbox-list">{SERVICE_CATEGORIES.map((item) => <label key={item.value} className="checkbox-option"><input type="checkbox" checked={categories.includes(item.value)} onChange={() => toggleCategory(item.value)} /><span>{item.label}</span></label>)}</div></Field><Field label="ABU Main Campus service zones"><div>{groupedZones.map(([group, items]) => <div className="zone-checkbox-group" key={group}><h4>{group}</h4><div className="zone-grid">{items.map((zone) => <label key={zone.id} className="zone-option"><input type="checkbox" checked={selectedZones.includes(zone.id)} onChange={() => toggleZone(zone.id)} /><span>{zone.name}</span></label>)}</div></div>)}</div></Field><Field label="Years of experience" hint="Optional"><input type="number" min="0" max="60" value={years} onChange={(event) => setYears(event.target.value)} /></Field><Field label="About your work"><textarea maxLength={1200} value={bio} onChange={(event) => setBio(event.target.value)} /></Field>{profileSaved && <Alert tone="success">Your profile changes were saved.</Alert>}<Button type="submit" disabled={busy}>Save profile</Button></form>
          </Card>
          <div className="form-stack"><Card className="card-pad"><p className="eyebrow">AVAILABILITY</p><h2>{artisan.is_available ? 'You are taking requests' : 'Your requests are paused'}</h2><p className="muted">Availability controls whether matching customers’ open requests are visible to you and whether you can send new offers. Turning availability off does not remove your FixMate verification.</p><Button variant={artisan.is_available ? 'secondary' : 'primary'} disabled={busy} onClick={() => void toggleAvailability()}>{artisan.is_available ? 'Pause requests' : 'Go available'}</Button></Card><Card className="card-pad"><p className="eyebrow">FIXMATE SUPPORT</p><h2>Need help with a review?</h2><p className="muted">FixMate may contact you to request more information or arrange a physical meeting. Do not send identity documents in chat.</p><WhatsAppSupport supabase={supabase} /></Card></div>
        </div>
      </>}
    </WorkspaceShell>
  );
}
