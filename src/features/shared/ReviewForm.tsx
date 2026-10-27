import { useState, type FormEvent } from 'react';
import { Star } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Field } from '../../components/ui';

export function ReviewForm({ supabase, requestId, customerId, artisanId, onSaved }: {
  supabase: SupabaseClient;
  requestId: string;
  customerId: string;
  artisanId: string;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState('5');
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('job_reviews').insert({
      request_id: requestId,
      customer_id: customerId,
      artisan_id: artisanId,
      rating: Number(rating),
      review: review.trim(),
    });
    if (insertError) setError(insertError.message);
    else onSaved();
    setBusy(false);
  }

  return (
    <form className="form-stack review-form" onSubmit={submit}>
      <Field label="Your rating"><select value={rating} onChange={(event) => setRating(event.target.value)}><option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Fine</option><option value="2">2 — Needs improvement</option><option value="1">1 — Poor</option></select></Field>
      <Field label="Review" hint="Optional · up to 1,500 characters"><textarea maxLength={1500} value={review} onChange={(event) => setReview(event.target.value)} placeholder="Share a fair, helpful note about the completed work." /></Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" disabled={busy}><Star size={16} />{busy ? 'Saving…' : 'Submit review'}</Button>
    </form>
  );
}
