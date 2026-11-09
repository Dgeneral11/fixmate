import type { FixmateRequestEvent } from '../../lib/types';
import { formatNaira } from '../../lib/catalog';

const eventTitle: Record<FixmateRequestEvent['event_type'], string> = {
  request_posted: 'Request created',
  request_status_changed: 'Request status updated',
  offer_sent: 'Artisan sent an offer',
  offer_status_changed: 'Offer status updated',
  review_submitted: 'Review submitted',
};

function describe(event: FixmateRequestEvent): string {
  const to = typeof event.details.to === 'string' ? event.details.to.replaceAll('_', ' ') : '';
  const from = typeof event.details.from === 'string' ? event.details.from.replaceAll('_', ' ') : '';
  const rating = typeof event.details.rating === 'number' ? event.details.rating : null;
  const quote = typeof event.details.quote_ngn === 'number' ? event.details.quote_ngn : null;
  if (event.event_type === 'request_status_changed' && to) return `${from ? `${from} → ` : ''}${to}`;
  if (event.event_type === 'offer_status_changed' && to) return `Offer ${to}${quote === null ? '' : ` · ${formatNaira(quote)}`}`;
  if (event.event_type === 'offer_sent') return quote === null ? 'Quote not included' : `Quote ${formatNaira(quote)}`;
  if (event.event_type === 'review_submitted' && rating !== null) return `Customer rated this job ${rating}/5`;
  if (event.event_type === 'request_posted') return event.details.targeted === true ? 'Sent directly to the selected artisan' : 'Shared with matching artisans';
  return '';
}

export function RequestHistory({ events }: { events: FixmateRequestEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="request-history">
      <summary>Job history ({events.length})</summary>
      <ol className="request-history__list">
        {events.map((event) => (
          <li key={event.id}>
            <span className="request-history__dot" aria-hidden="true" />
            <div><strong>{eventTitle[event.event_type]}</strong>{describe(event) && <span>{describe(event)}</span>}<time dateTime={event.created_at}>{new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}</time></div>
          </li>
        ))}
      </ol>
    </details>
  );
}
