import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Button, Card, Field } from '../../components/ui';
import type { ArtisanPortfolioItem } from '../../lib/types';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';

const MAX_BYTES = 8 * 1024 * 1024;
interface PortfolioView extends ArtisanPortfolioItem { url: string; }

export function ArtisanPortfolioManager({ supabase, artisanId }: { supabase: SupabaseClient; artisanId: string }) {
  const [items, setItems] = useState<PortfolioView[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadGeneration = useRef(0);

  async function load() {
    const generation = ++loadGeneration.current;
    const { data, error: queryError } = await supabase.from('artisan_portfolio_items')
      .select('id, artisan_id, storage_path, caption, created_at').eq('artisan_id', artisanId)
      .order('created_at', { ascending: false }).limit(12);
    if (queryError) { setError(queryError.message); return; }
    const next = (data ?? []) as ArtisanPortfolioItem[];
    const signed = await Promise.all(next.map(async (item) => {
      const { data: urlData } = await supabase.storage.from('fixmate-marketplace-media').createSignedUrl(item.storage_path, 300);
      return { ...item, url: urlData?.signedUrl ?? '' };
    }));
    if (generation === loadGeneration.current) setItems(signed.filter((item) => item.url));
  }

  useRealtimeRefresh({
    supabase,
    identity: artisanId,
    scope: 'artisan-portfolio',
    tables: [
      { table: 'artisan_portfolio_items', filter: `artisan_id=eq.${artisanId}` },
      { table: 'artisan_profiles', filter: `user_id=eq.${artisanId}` },
    ],
    onChange: load,
  });

  useEffect(() => { void load(); }, [supabase, artisanId]);

  async function addPhoto() {
    if (!file) { setError('Choose a JPG or PNG image.'); return; }
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Use a JPG or PNG image.'); return; }
    if (file.size > MAX_BYTES) { setError('Each photo must be 8 MB or smaller.'); return; }
    if (items.length >= 12) { setError('Keep up to 12 portfolio photos. Remove one before adding another.'); return; }
    setBusy(true); setError(''); setNotice('');
    const extension = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `artisan-portfolio/${artisanId}/${crypto.randomUUID()}.${extension}`;
    try {
      const { error: uploadError } = await supabase.storage.from('fixmate-marketplace-media').upload(path, file, {
        upsert: false, contentType: file.type, cacheControl: '3600',
      });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from('artisan_portfolio_items').insert({ artisan_id: artisanId, storage_path: path, caption: caption.trim() });
      if (insertError) { await supabase.storage.from('fixmate-marketplace-media').remove([path]); throw insertError; }
      setFile(null); setCaption(''); setNotice('Portfolio photo added. Approved customers can now view it on your profile.');
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The portfolio photo could not be added.');
    } finally { setBusy(false); }
  }

  async function remove(item: PortfolioView) {
    setBusy(true); setError(''); setNotice('');
    const { error: storageError } = await supabase.storage.from('fixmate-marketplace-media').remove([item.storage_path]);
    if (storageError) { setError(storageError.message); setBusy(false); return; }
    const { error: deleteError } = await supabase.from('artisan_portfolio_items').delete().eq('id', item.id);
    if (deleteError) setError(deleteError.message);
    else { setNotice('Portfolio photo removed.'); await load(); }
    setBusy(false);
  }

  return <section className="dashboard-section portfolio-manager">
    <div className="section-heading"><div><p className="eyebrow">OPTIONAL PROFILE PHOTOS</p><h2>Work & achievements</h2><p className="muted">Add up to 12 JPG or PNG photos. Identity and trade evidence stays private and does not appear here.</p></div><ImageIcon size={18} color="#5d8a72" /></div>
    <Card className="card-pad"><div className="form-grid"><Field label="Photo" hint="JPG or PNG · maximum 8 MB"><input type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field><Field label="Short caption (optional)"><input maxLength={240} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="A completed repair or project" /></Field></div>
      {error && <Alert>{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
      <Button disabled={busy || !file || items.length >= 12} onClick={() => void addPhoto()}><Upload size={15} /> Add photo</Button>
      {items.length > 0 && <div className="portfolio-manager-grid">{items.map((item) => <figure key={item.id}><img src={item.url} alt={item.caption || 'Your portfolio photo'} loading="lazy" />{item.caption && <figcaption>{item.caption}</figcaption>}<Button variant="quiet" disabled={busy} onClick={() => void remove(item)}><Trash2 size={14} /> Remove</Button></figure>)}</div>}
    </Card>
  </section>;
}
