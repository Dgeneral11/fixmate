import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, CheckCheck, ClipboardList, Compass, MessageSquareText, Search, Settings2, Star, UserRound, Wrench } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceShell, type WorkspaceNavItem } from '../../components/WorkspaceShell';
import { Alert, AppHeader, Button, Card, EmptyState, Field, LoadingState, StatusPill } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { cleanWhatsAppNumber, formatDate, formatNaira, groupZones, SERVICE_CATEGORIES, serviceLabel } from '../../lib/catalog';
import type { ArtisanOffer, ArtisanProfile, CustomerRequest, JobReview, Profile, ServiceCategory, ServiceZone } from '../../lib/types';
import { ComplaintForm } from '../shared/ComplaintForm';
import { MessagesPanel, type ConversationRef } from '../shared/MessagesPanel';
import { ReviewForm } from '../shared/ReviewForm';

interface Props {
  supabase: SupabaseClient;
  profile: Profile;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

type CustomerTab = 'discover' | 'requests' | 'messages' | 'account';
const navItems: ReadonlyArray<WorkspaceNavItem<CustomerTab>> = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'requests', label: 'Requests', icon: ClipboardList },
  { id: 'messages', label: 'Messages', icon: MessageSquareText },
  { id: 'account', label: 'Account', icon: UserRound },
];

export function CustomerDashboard({ supabase, profile, onRefresh, onSignOut }: Props) {
  const [activeTab, setActiveTab] = useState<CustomerTab>('discover');
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [offers, setOffers] = useState<ArtisanOffer[]>([]);
  const [artisans, setArtisans] = useState<ArtisanProfile[]>([]);
  const [artisanZones, setArtisanZones] = useState<Array<{ artisan_id: string; zone_id: string }>>([]);
  const [artisanNames, setArtisanNames] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<JobReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [filterCategory, setFilterCategory] = useState<ServiceCategory | ''>('');
  const [filterZone, setFilterZone] = useState('');
  const [requestCategory, setRequestCategory] = useState<ServiceCategory>('electrical_repairs');
  const [requestZone, setRequestZone] = useState('');
  const [requestTitle, setRequestTitle] = useState('');
  const [requestDescription, setRequestDescription] = useState('');
  const [accountName, setAccountName] = useState(profile.display_name);
  const [accountPhone, setAccountPhone] = useState(profile.phone ?? '');
  const [accountSaved, setAccountSaved] = useState(false);

  async function loadData() {
    setLoading(true);
    setError('');
    setLoadError('');
    const [zoneResult, requestResult, artisanResult, artisanZoneResult] = await Promise.all([
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').eq('is_active', true).order('sort_order'),
      supabase.from('customer_requests').select('id, customer_id, service_category, zone_id, title, description, status, created_at').eq('customer_id', profile.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('artisan_profiles').select('user_id, display_name, service_categories, years_experience, service_area, bio, is_available').order('updated_at', { ascending: false }).limit(100),
      supabase.from('artisan_service_zones').select('artisan_id, zone_id').limit(500),
    ]);
    const firstError = zoneResult.error ?? requestResult.error ?? artisanResult.error ?? artisanZoneResult.error;
    if (firstError) setLoadError(firstError.message);
    const nextZones = (zoneResult.data ?? []) as ServiceZone[];
    const nextRequests = (requestResult.data ?? []) as CustomerRequest[];
    const nextArtisans = (artisanResult.data ?? []) as ArtisanProfile[];
    const nextOffers: ArtisanOffer[] = [];
    const nextReviews: JobReview[] = [];
    const nextNames: Record<string, string> = {};
    const requestIds = nextRequests.map((item) => item.id);

    if (requestIds.length) {
      const { data: offerData, error: offerError } = await supabase.from('artisan_offers')
        .select('id, request_id, artisan_id, quote_ngn, message, status, created_at')
        .in('request_id', requestIds).order('created_at', { ascending: true }).limit(500);
      if (offerError) setLoadError(offerError.message);
      nextOffers.push(...((offerData ?? []) as ArtisanOffer[]));
      const completedIds = nextRequests.filter((item) => item.status === 'completed').map((item) => item.id);
      if (completedIds.length) {
        const { data: reviewData, error: reviewError } = await supabase.from('job_reviews')
          .select('id, request_id, customer_id, artisan_id, rating, review, created_at')
          .in('request_id', completedIds);
        if (reviewError) setLoadError(reviewError.message);
        nextReviews.push(...((reviewData ?? []) as JobReview[]));
      }
    }
    const artisanIds = [...new Set(nextOffers.map((item) => item.artisan_id))];
    if (artisanIds.length) {
      const { data: nameData, error: nameError } = await supabase.from('artisan_profiles').select('user_id, display_name').in('user_id', artisanIds);
      if (nameError) setLoadError(nameError.message);
      for (const item of nameData ?? []) nextNames[item.user_id] = item.display_name || 'Verified artisan';
    }

    setZones(nextZones);
    setRequests(nextRequests);
    setOffers(nextOffers);
    setArtisans(nextArtisans);
    setArtisanZones((artisanZoneResult.data ?? []) as Array<{ artisan_id: string; zone_id: string }>);
    setArtisanNames(nextNames);
    setReviews(nextReviews);
    if (!requestZone && nextZones[0]) setRequestZone(nextZones[0].id);
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, [profile.id]);

  const zoneName = (id: string) => zones.find((zone) => zone.id === id)?.name ?? 'ABU Main Campus zone';
  const visibleArtisans = useMemo(() => artisans.filter((artisan) => {
    const matchesCategory = !filterCategory || artisan.service_categories.includes(filterCategory);
    const matchesZone = !filterZone || artisanZones.some((item) => item.artisan_id === artisan.user_id && item.zone_id === filterZone);
    return matchesCategory && matchesZone;
  }), [artisans, artisanZones, filterCategory, filterZone]);
  const conversations: ConversationRef[] = offers.map((offer) => {
    const request = requests.find((item) => item.id === offer.request_id);
    return {
      offerId: offer.id,
      requestId: offer.request_id,
      requestTitle: request?.title ?? 'Service request',
      otherName: artisanNames[offer.artisan_id] ?? 'Verified artisan',
      status: offer.status,
    };
  });

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!requestZone) { setError('Choose one active ABU Main Campus service zone.'); return; }
    setBusy(true);
    const { error: insertError } = await supabase.from('customer_requests').insert({
      customer_id: profile.id,
      service_category: requestCategory,
      zone_id: requestZone,
      title: requestTitle.trim(),
      description: requestDescription.trim(),
      status: 'open',
    });
    if (insertError) setError(insertError.message);
    else {
      setRequestTitle('');
      setRequestDescription('');
      setActiveTab('requests');
      await loadData();
    }
    setBusy(false);
  }

  async function respondToOffer(offerId: string, accept: boolean) {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('fixmate_customer_respond_to_offer', { p_offer_id: offerId, p_accept: accept });
    if (rpcError) setError(rpcError.message);
    else await loadData();
    setBusy(false);
  }

  async function updateRequestStatus(requestId: string, action: 'cancel' | 'complete') {
    setBusy(true);
    setError('');
    const { error: rpcError } = action === 'cancel'
      ? await supabase.rpc('fixmate_customer_cancel_request', { p_request_id: requestId })
      : await supabase.rpc('fixmate_complete_request', { p_request_id: requestId });
    if (rpcError) setError(rpcError.message);
    else await loadData();
    setBusy(false);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountSaved(false);
    setError('');
    const phone = cleanWhatsAppNumber(accountPhone);
    if (!/^\+?[0-9]{10,15}$/.test(phone)) { setError('Enter a WhatsApp contact number with 10–15 digits.'); return; }
    setBusy(true);
    const { error: updateError } = await supabase.from('profiles').update({ display_name: accountName.trim(), phone }).eq('id', profile.id);
    if (updateError) setError(updateError.message);
    else { setAccountSaved(true); await onRefresh(); }
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading ABU Main Campus services…" />;
  const groupedZones = groupZones(zones);

  return (
    <WorkspaceShell profile={profile} roleLabel="Approved customer" navItems={navItems} activeTab={activeTab} onTabChange={setActiveTab} onSignOut={onSignOut}>
      {error && <Alert>{error}</Alert>}{loadError && <Alert>{loadError}</Alert>}
      {activeTab === 'discover' && <>
        <AppHeader eyebrow="ABU MAIN CAMPUS PILOT" title="Find help nearby" detail="Choose from approved FixMate services and the campus zones currently active in the pilot." action={<Button onClick={() => document.getElementById('request-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Request a service</Button>} />
        <div className="service-grid">{SERVICE_CATEGORIES.map((item) => <div className="service-card" key={item.value}><span className="service-card__icon"><Wrench size={19} /></span><strong>{item.label}</strong><p>Available within the ABU Main Campus pilot zones.</p></div>)}</div>
        <section className="dashboard-section">
          <div className="section-heading"><div><p className="eyebrow">VERIFIED ARTISANS</p><h2>Explore FixMate-verified artisans</h2></div><Search size={18} color="#5d8a72" /></div>
          <div className="filter-row">
            <Field label="Service"><select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as ServiceCategory | '')}><option value="">All pilot services</option>{SERVICE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <Field label="Campus zone"><select value={filterZone} onChange={(event) => setFilterZone(event.target.value)}><option value="">All active zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></Field>
          </div>
          {visibleArtisans.length ? <div className="section-grid">{visibleArtisans.map((artisan) => (
            <Card key={artisan.user_id} className="card-pad">
              <div className="list-card__top"><div><h3>{artisan.display_name || 'Verified artisan'}</h3><p className="muted">{artisan.years_experience != null ? `${artisan.years_experience} years of experience` : 'Experience not listed'}</p></div><StatusPill status={artisan.is_available ? 'available' : 'not taking requests'} /></div>
              <p className="list-card__body">{artisan.bio || 'A FixMate-verified provider in the ABU Main Campus pilot.'}</p>
              <div className="service-tags">{artisan.service_categories.map((category) => <span className="tag" key={category}>{serviceLabel(category)}</span>)}</div>
              <p className="field__hint">Zones: {artisanZones.filter((item) => item.artisan_id === artisan.user_id).map((item) => zoneName(item.zone_id)).join(', ') || 'No active zones listed'}</p>
            </Card>
          ))}</div> : loadError ? <EmptyState title="Artisan results could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no matching providers." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title="No verified artisans match these filters" detail="FixMate lists only providers whose administrator review is approved. Try a different campus zone or service, or place a service request for matching artisans." />}
        </section>
        <section id="request-form" className="dashboard-section customer-request-layout">
          <Card className="request-form-card">
            <div className="card-heading"><div><p className="eyebrow">SERVICE REQUEST</p><h2>Tell us what you need</h2><p>Your request is shared only with eligible, available verified artisans for the selected service and zone.</p></div><span className="service-card__icon"><ClipboardList size={19} /></span></div>
            <form className="form-stack" onSubmit={createRequest}>
              <Field label="Service category"><select required value={requestCategory} onChange={(event) => setRequestCategory(event.target.value as ServiceCategory)}>{SERVICE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
              <Field label="ABU Main Campus zone"><select required value={requestZone} onChange={(event) => setRequestZone(event.target.value)}><option value="">Choose one zone</option>{groupedZones.map(([group, items]) => <optgroup key={group} label={group}>{items.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</optgroup>)}</select></Field>
              <Field label="Short title"><input required minLength={3} maxLength={100} value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="e.g. Repair a desk lamp" /></Field>
              <Field label="Describe the work"><textarea required minLength={10} maxLength={2500} value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="Include useful details, timing, and where to meet in this zone. Do not add private ID details." /></Field>
              <Button type="submit" disabled={busy}>{busy ? 'Posting request…' : 'Post service request'}</Button>
            </form>
          </Card>
          <div className="request-side-note"><div className="service-card__icon"><CalendarDays size={19} /></div><h3>What happens next?</h3><p>Eligible artisans can send real offers. You decide whether to accept one, then use the request conversation to agree on details.</p><p className="field__hint">FixMate does not claim that a service is booked until you accept an artisan’s offer.</p></div>
        </section>
      </>}

      {activeTab === 'requests' && <>
        <AppHeader eyebrow="YOUR SERVICE ACTIVITY" title="Requests & offers" detail="Review offers, continue conversations, and manage the status of your real service requests." action={<Button onClick={() => setActiveTab('discover')}>New request</Button>} />
        {!requests.length ? loadError ? <EmptyState title="Your requests could not be confirmed" detail="A live FixMate query failed. Retry before assuming there are no saved requests." action={<Button variant="secondary" onClick={() => void loadData()}>Retry</Button>} /> : <EmptyState title="No service requests yet" detail="When you post a real request for an ABU Main Campus zone, it will appear here." action={<Button onClick={() => setActiveTab('discover')}>Browse services</Button>} /> : <div className="list-stack">{requests.map((request) => {
          const requestOffers = offers.filter((offer) => offer.request_id === request.id);
          const acceptedOffer = requestOffers.find((offer) => offer.status === 'accepted');
          const review = reviews.find((item) => item.request_id === request.id);
          return <Card key={request.id} className="card-pad request-card">
            <div className="list-card__top"><div><p className="eyebrow">{serviceLabel(request.service_category)} · {zoneName(request.zone_id)}</p><h3>{request.title}</h3></div><StatusPill status={request.status} /></div>
            <p className="list-card__body">{request.description}</p>
            <div className="list-card__meta"><span><CalendarDays size={14} /> {formatDate(request.created_at)}</span><span>{requestOffers.length} {requestOffers.length === 1 ? 'offer' : 'offers'}</span></div>
            {!!requestOffers.length && <div className="offer-list">{requestOffers.map((offer) => <div className="offer-card" key={offer.id}>
              <div className="list-card__top"><div><strong>{artisanNames[offer.artisan_id] ?? 'Verified artisan'}</strong><p className="field__hint">{formatNaira(offer.quote_ngn)} · {formatDate(offer.created_at)}</p></div><StatusPill status={offer.status} /></div>
              <p className="list-card__body">{offer.message}</p>
              {request.status === 'open' && offer.status === 'pending' && <div className="list-card__actions"><Button disabled={busy} onClick={() => void respondToOffer(offer.id, true)}><CheckCheck size={15} /> Accept offer</Button><Button variant="quiet" disabled={busy} onClick={() => void respondToOffer(offer.id, false)}>Decline</Button></div>}
              {request.status !== 'cancelled' && <div className="list-card__actions"><ComplaintForm supabase={supabase} requestId={request.id} reporterId={profile.id} subjectUserId={offer.artisan_id} /></div>}
            </div>)}</div>}
            {request.status === 'open' && <div className="list-card__actions"><Button variant="quiet" disabled={busy} onClick={() => void updateRequestStatus(request.id, 'cancel')}>Cancel request</Button></div>}
            {request.status === 'accepted' && <div className="list-card__actions"><Button variant="secondary" disabled={busy} onClick={() => void updateRequestStatus(request.id, 'complete')}>Mark work complete</Button></div>}
            {request.status === 'completed' && acceptedOffer && (loadError ? <Alert>A live query failed; retry before submitting a review.</Alert> : review ? <Alert tone="success">Your review was submitted for this completed request.</Alert> : <div className="review-wrap"><div className="section-kicker">Share a review</div><ReviewForm supabase={supabase} requestId={request.id} customerId={profile.id} artisanId={acceptedOffer.artisan_id} onSaved={() => void loadData()} /></div>)}
          </Card>;
        })}</div>}
      </>}

      {activeTab === 'messages' && <>
        <AppHeader eyebrow="PRIVATE CONVERSATIONS" title="Messages" detail="Messages are limited to the customer and artisan on a real service offer." />
        <MessagesPanel supabase={supabase} userId={profile.id} conversations={conversations} />
      </>}

      {activeTab === 'account' && <>
        <AppHeader eyebrow="ACCOUNT & PRIVACY" title="Your account" detail="Your contact information stays private and is visible to you and authorized FixMate administrators." />
        <div className="section-grid">
          <Card className="card-pad"><div className="card-heading"><div><p className="eyebrow">PROFILE</p><h2>Contact details</h2><p>Email: {profile.email || 'Not available'}</p></div><span className="service-card__icon"><Settings2 size={19} /></span></div>
            <form className="form-stack" onSubmit={saveAccount}><Field label="Name"><input required maxLength={120} value={accountName} onChange={(event) => setAccountName(event.target.value)} /></Field><Field label="WhatsApp number" hint="Used for account contact only; not your login method."><input required type="tel" value={accountPhone} onChange={(event) => setAccountPhone(event.target.value)} /></Field>{accountSaved && <Alert tone="success">Your private contact details were saved.</Alert>}<Button type="submit" disabled={busy}>Save details</Button></form>
          </Card>
          <Card className="card-pad"><p className="eyebrow">FIXMATE SUPPORT</p><h2>Need help?</h2><p className="muted">Contact the FixMate administrator through the configured WhatsApp support line. The link opens WhatsApp with a draft; it does not send automatically.</p><WhatsAppSupport supabase={supabase} /><div className="privacy-notice"><Star size={17} /><p>Student IDs and other private evidence are not sent through WhatsApp. NIN and date of birth are not required by default.</p></div><Button variant="quiet" onClick={onSignOut}>Sign out</Button></Card>
        </div>
      </>}
    </WorkspaceShell>
  );
}
