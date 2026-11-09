import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Image as ImageIcon } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert } from '../../components/ui';
import type { CustomerRequestAttachment } from '../../lib/types';

export function RequestAttachments({ supabase, requestId, refreshRevision = 0 }: { supabase: SupabaseClient; requestId: string; refreshRevision?: number }) {
  const [items, setItems] = useState<CustomerRequestAttachment[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const generationRef = useRef(0);

  async function load() {
    const generation = ++generationRef.current;
    setError('');
    const { data, error: queryError } = await supabase.from('customer_request_attachments')
      .select('id, request_id, uploaded_by, storage_path, created_at')
      .eq('request_id', requestId).order('created_at').limit(5);
    if (generation !== generationRef.current) return;
    if (queryError) { setError('Reference photos could not be loaded.'); return; }
    const next = (data ?? []) as CustomerRequestAttachment[];
    const signed = await Promise.all(next.map(async (item) => {
      const { data: urlData } = await supabase.storage.from('fixmate-marketplace-media').createSignedUrl(item.storage_path, 300);
      return [item.id, urlData?.signedUrl ?? ''] as const;
    }));
    if (generation === generationRef.current) { setItems(next); setUrls(Object.fromEntries(signed)); }
  }

  useEffect(() => {
    void load();
    const refreshIfVisible = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      generationRef.current += 1;
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [supabase, requestId, refreshRevision]);

  if (!items.length && !error) return null;
  return <div className="request-attachments"><p className="section-kicker"><ImageIcon size={14} /> Reference photos</p>{error && <Alert>{error}</Alert>}{items.length > 0 && <div className="request-attachments__grid">{items.map((item) => urls[item.id] ? <a key={item.id} href={urls[item.id]} target="_blank" rel="noreferrer" aria-label="Open request reference photo"><img src={urls[item.id]} alt="Customer-provided reference" loading="lazy" /><ExternalLink size={14} /></a> : <span key={item.id} className="field__hint">Photo unavailable</span>)}</div>}</div>;
}
