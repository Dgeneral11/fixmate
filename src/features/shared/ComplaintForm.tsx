import { useState, type FormEvent } from 'react';
import { Flag } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Field } from '../../components/ui';

interface Props {
  supabase: SupabaseClient;
  requestId: string;
  reporterId: string;
  subjectUserId: string;
}

export function ComplaintForm({ supabase, requestId, reporterId, subjectUserId }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'safety' | 'workmanship' | 'communication' | 'conduct' | 'other'>('safety');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const { error: insertError } = await supabase.from('user_complaints').insert({
      request_id: requestId,
      reporter_id: reporterId,
      subject_user_id: subjectUserId,
      reason,
      details: details.trim(),
    });
    if (insertError) setError(insertError.message);
    else { setSent(true); setOpen(false); setDetails(''); }
    setBusy(false);
  }

  if (sent) return <span className="field__hint" role="status">Complaint sent to FixMate for private review.</span>;
  return (
    <div className="complaint-control">
      {!open ? <Button variant="quiet" onClick={() => setOpen(true)}><Flag size={15} /> Report a concern</Button> : (
        <form className="form-stack complaint-form" onSubmit={submit}>
          <Field label="Reason"><select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}><option value="safety">Safety</option><option value="workmanship">Workmanship</option><option value="communication">Communication</option><option value="conduct">Conduct</option><option value="other">Other</option></select></Field>
          <Field label="What happened?" hint="This report is visible to you and FixMate administrators. FixMate may contact the other person if review requires it."><textarea required minLength={10} maxLength={2500} value={details} onChange={(event) => setDetails(event.target.value)} /></Field>
          {error && <Alert>{error}</Alert>}
          <div className="button-row"><Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send private report'}</Button><Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      )}
    </div>
  );
}
