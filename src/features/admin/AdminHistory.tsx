import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Card, EmptyState, LoadingState, StatusPill } from '../../components/ui';
import { formatDate, serviceLabel } from '../../lib/catalog';
import type { CustomerRequest, FixmateRequestEvent, Profile } from '../../lib/types';

interface Actor extends Pick<Profile, 'id' | 'display_name' | 'role'> {}

function eventText(event: FixmateRequestEvent): string {
  const to = typeof event.details.to === 'string' ? event.details.to.replaceAll('_', ' ') : '';
  const rating = typeof event.details.rating === 'number' ? event.details.rating : null;
  if (event.event_type === 'request_posted') return event.details.targeted === true ? 'Request sent directly to a selected artisan' : 'Request shared with the matching pool';
  if (event.event_type === 'request_status_changed') return to ? `Request status changed to ${to}` : 'Request status changed';
  if (event.event_type === 'offer_sent') return 'Artisan sent an offer';
  if (event.event_type === 'offer_status_changed') return to ? `Offer status changed to ${to}` : 'Offer status changed';
  if (event.event_type === 'review_submitted') return rating === null ? 'Customer submitted a review' : `Customer submitted a ${rating}/5 review`;
  return 'Request activity';
}

export function AdminHistory({ supabase, refreshRevision = 0 }: { supabase: SupabaseClient; refreshRevision?: number }) {
  const [events, setEvents] = useState<FixmateRequestEvent[]>([]);
  const [requests, setRequests] = useState<Record<string, CustomerRequest>>({});
  const [actors, setActors] = useState<Record<string, Actor>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(background = false) {
    if (!background) setLoading(true); setError('');
    const { data, error: eventError } = await supabase.from('fixmate_request_events')
      .select('id, request_id, actor_id, event_type, details, created_at')
      .order('created_at', { ascending: false }).limit(500);
    if (eventError) { setError(eventError.message); if (!background) setLoading(false); return; }
    const nextEvents = (data ?? []) as FixmateRequestEvent[];
    setEvents(nextEvents);
    const requestIds = [...new Set(nextEvents.map((event) => event.request_id))];
    const actorIds = [...new Set(nextEvents.map((event) => event.actor_id).filter((id): id is string => Boolean(id)))];
    const [requestResult, actorResult] = await Promise.all([
      requestIds.length ? supabase.from('customer_requests').select('id, customer_id, target_artisan_id, service_category, zone_id, title, description, status, created_at').in('id', requestIds) : Promise.resolve({ data: [], error: null }),
      actorIds.length ? supabase.from('profiles').select('id, display_name, role').in('id', actorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (requestResult.error) setError(requestResult.error.message);
    if (actorResult.error) setError(actorResult.error.message);
    const requestMap: Record<string, CustomerRequest> = {};
    for (const item of (requestResult.data ?? []) as CustomerRequest[]) requestMap[item.id] = item;
    const actorMap: Record<string, Actor> = {};
    for (const item of (actorResult.data ?? []) as Actor[]) actorMap[item.id] = item;
    setRequests(requestMap); setActors(actorMap); if (!background) setLoading(false);
  }

  useEffect(() => { void load(); }, [supabase]);
  useEffect(() => { if (refreshRevision > 0) void load(true); }, [refreshRevision]);
  if (loading) return <LoadingState label="Loading FixMate job history…" />;

  return <section className="admin-section">
    <div className="admin-toolbar"><div><p className="eyebrow">MARKETPLACE AUDIT</p><h2>Job history</h2><p className="muted">Recent requests, offers, status changes, and reviews. Chat contents and identity documents are not included.</p></div><Button variant="secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button></div>
    {error && <Alert>{error}</Alert>}
    {!events.length ? error ? <EmptyState title="Job history could not be confirmed" detail="A live query failed. Retry before assuming no history exists." action={<Button variant="secondary" onClick={() => void load()}>Retry</Button>} /> : <EmptyState title="No request activity yet" detail="Request and offer activity will be recorded here as it happens." /> : <div className="list-stack">{events.map((event) => {
      const request = requests[event.request_id];
      const actor = event.actor_id ? actors[event.actor_id] : undefined;
      return <Card className="card-pad admin-history-row" key={event.id}><div className="admin-history-row__icon"><History size={17} /></div><div className="admin-history-row__main"><div className="list-card__top"><div><p className="eyebrow">{eventText(event)}</p><h3>{request?.title ?? 'Request record'}</h3></div>{request && <StatusPill status={request.status} />}</div><div className="list-card__meta"><span>{request ? serviceLabel(request.service_category) : 'FixMate request'}</span><span>{actor?.display_name || 'System'}{actor?.role ? ` · ${actor.role}` : ''}</span><time dateTime={event.created_at}>{formatDate(event.created_at)}</time></div></div></Card>;
    })}</div>}
  </section>;
}
