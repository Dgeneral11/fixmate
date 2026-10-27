import { useEffect, useState, type FormEvent } from 'react';
import { MessageSquareText, Send } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, EmptyState } from '../../components/ui';
import { formatDate } from '../../lib/catalog';
import type { RequestMessage } from '../../lib/types';

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
  const [error, setError] = useState('');
  const selected = conversations.find((conversation) => conversation.offerId === selectedId) ?? conversations[0];

  async function loadMessages(offerId: string) {
    setError('');
    const { data, error: queryError } = await supabase.from('request_messages')
      .select('id, offer_id, sender_id, body, created_at')
      .eq('offer_id', offerId).order('created_at', { ascending: true }).limit(100);
    if (queryError) setError(queryError.message);
    else setMessages((data ?? []) as RequestMessage[]);
  }

  useEffect(() => {
    if (!conversations.length) { setSelectedId(''); setMessages([]); return; }
    if (!conversations.some((conversation) => conversation.offerId === selectedId)) setSelectedId(conversations[0].offerId);
  }, [conversations, selectedId]);

  useEffect(() => {
    if (selected) void loadMessages(selected.offerId);
  }, [selected?.offerId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setBusy(true);
    setError('');
    const { error: sendError } = await supabase.from('request_messages').insert({
      offer_id: selected.offerId,
      sender_id: userId,
      body: draft.trim(),
    });
    if (sendError) setError(sendError.message);
    else {
      setDraft('');
      await loadMessages(selected.offerId);
    }
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
        <div className="card-heading"><div><p className="eyebrow">SERVICE REQUEST</p><h3>{selected?.requestTitle}</h3><p>Conversation with {selected?.otherName || 'FixMate member'}</p></div><MessageSquareText size={19} color="#00875a" /></div>
        {error && <Alert>{error}</Alert>}
        <div className="chat-stream" aria-live="polite">
          {!messages.length ? <p className="field__hint">No messages in this conversation yet.</p> : messages.map((message) => (
            <div key={message.id} className={`chat-bubble${message.sender_id === userId ? ' is-mine' : ''}`}>
              {message.body}<small>{formatDate(message.created_at)}</small>
            </div>
          ))}
        </div>
        <form className="chat-form" onSubmit={sendMessage}>
          <input maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message" aria-label="Write a message" />
          <Button type="submit" disabled={busy || !draft.trim()} ariaLabel="Send message">{busy ? 'Sending…' : <Send size={16} />}</Button>
        </form>
      </section>
    </div>
  );
}
