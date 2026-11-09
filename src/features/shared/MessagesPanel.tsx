import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageSquareText, RefreshCw, Send } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, EmptyState } from '../../components/ui';
import { formatDate } from '../../lib/catalog';
import type { RequestMessage } from '../../lib/types';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

export interface ConversationRef {
  offerId: string;
  requestId: string;
  requestTitle: string;
  otherName: string;
  status: string;
}

export function MessagesPanel({ supabase, userId, conversations }: {
  supabase: SupabaseClient;
  userId: string;
  conversations: ConversationRef[];
}) {
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<RequestMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState('');
  const [freshStatus, setFreshStatus] = useState('');
  const refreshGeneration = useRef(0);
  const selected = conversations.find((conversation) => conversation.offerId === selectedId) ?? conversations[0];

  async function refreshConversation(conversation: ConversationRef, quiet = false) {
    const generation = ++refreshGeneration.current;
    setError('');
    if (!quiet) { setLoadingConversation(true); setMessages([]); setFreshStatus(''); }
    const [messageResult, offerResult, requestResult] = await Promise.all([
      supabase.from('request_messages').select('id, offer_id, sender_id, body, created_at')
        .eq('offer_id', conversation.offerId).order('created_at', { ascending: true }).limit(100),
      supabase.from('artisan_offers').select('status').eq('id', conversation.offerId).maybeSingle(),
      supabase.from('customer_requests').select('status').eq('id', conversation.requestId).maybeSingle(),
    ]);
    if (generation !== refreshGeneration.current) return;
    const queryError = messageResult.error ?? offerResult.error ?? requestResult.error;
    if (queryError) setError(queryError.message);
    else {
      setMessages((messageResult.data ?? []) as RequestMessage[]);
      if (offerResult.data && requestResult.data) setFreshStatus(`Request ${requestResult.data.status.replaceAll('_', ' ')} · Offer ${offerResult.data.status.replaceAll('_', ' ')}`);
    }
    setLoadingConversation(false);
  }

  useRealtimeRefresh({
    supabase,
    identity: selected?.offerId ?? null,
    scope: 'conversation',
    tables: selected ? [
      { table: 'request_messages', filter: `offer_id=eq.${selected.offerId}`, events: ['INSERT', 'UPDATE'] },
      { table: 'artisan_offers', filter: `id=eq.${selected.offerId}` },
      { table: 'customer_requests', filter: `id=eq.${selected.requestId}` },
    ] : [],
    onChange: () => selected ? refreshConversation(selected, true) : undefined,
  });

  useEffect(() => {
    if (!conversations.length) { setSelectedId(''); setMessages([]); return; }
    if (!conversations.some((conversation) => conversation.offerId === selectedId)) setSelectedId(conversations[0].offerId);
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!selected) return;
    void refreshConversation(selected);
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refreshConversation(selected, true);
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [supabase, selected?.offerId, selected?.requestId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true); setError('');
    const { error: sendError } = await supabase.from('request_messages').insert({ offer_id: selected.offerId, sender_id: userId, body: draft.trim() });
    if (sendError) setError(sendError.message);
    else { setDraft(''); await refreshConversation(selected, true); }
    setBusy(false);
  }

  if (!conversations.length) {
    return <EmptyState title="No conversations yet" detail="Messages appear here only after a real artisan offer is attached to one of your service requests." />;
  }

  return (
    <div className="message-layout">
      <div className="conversation-list">
        {conversations.map((conversation) => (
          <button key={conversation.offerId} type="button" className={`conversation-button${(selected?.offerId ?? '') === conversation.offerId ? ' is-active' : ''}`} onClick={() => setSelectedId(conversation.offerId)}>
            <strong>{conversation.otherName || 'FixMate member'}</strong>
            <small>{conversation.requestTitle} · {conversation.status.replaceAll('_', ' ')}</small>
          </button>
        ))}
      </div>
      <section className="card chat-panel" aria-label="Request conversation">
        <div className="card-heading"><div><p className="eyebrow">SERVICE REQUEST</p><h3>{selected?.requestTitle}</h3><p>Conversation with {selected?.otherName || 'FixMate member'}</p><p className="field__hint">{freshStatus || selected?.status.replaceAll('_', ' ')}</p></div><div className="message-panel-actions"><MessageSquareText size={19} color="#00875a" /><Button variant="quiet" disabled={loadingConversation} onClick={() => selected && void refreshConversation(selected)} ariaLabel="Refresh conversation"><RefreshCw size={16} /></Button></div></div>
        {error && <Alert>{error}</Alert>}
        <div className="chat-stream" aria-live="polite">
          {loadingConversation ? <p className="field__hint">Refreshing messages…</p> : error ? <p className="field__hint">Messages could not be refreshed. Use Refresh to try again.</p> : !messages.length ? <p className="field__hint">No messages in this conversation yet.</p> : messages.map((message) => (
            <div key={message.id} className={`chat-bubble${message.sender_id === userId ? ' is-mine' : ''}`}>
              {message.body}<small>{formatDate(message.created_at)}</small>
            </div>
          ))}
        </div>
        <form className="chat-form" onSubmit={(event) => void sendMessage(event)}>
          <input maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message" aria-label="Write a message" />
          <Button type="submit" disabled={busy || !draft.trim()} ariaLabel="Send message">{busy ? 'Sending…' : <Send size={16} />}</Button>
        </form>
      </section>
    </div>
  );
}
