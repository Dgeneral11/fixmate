import { useState, type FormEvent } from 'react';
import { ArrowLeft, Image as ImageIcon, Send } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, AppHeader, Button, Card, Field } from '../../components/ui';
import { groupZones, SERVICE_CATEGORIES, serviceLabel } from '../../lib/catalog';
import type { ArtisanProfile, Profile, ServiceCategory, ServiceZone } from '../../lib/types';

interface Props {
  supabase: SupabaseClient;
  customer: Profile;
  artisan: ArtisanProfile;
  zones: ServiceZone[];
  onBack: () => void;
  onSubmitted: (notice?: string) => void;
}
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 5;

export function DirectServiceRequestPage({ supabase, customer, artisan, zones, onBack, onSubmitted }: Props) {
  const categories = SERVICE_CATEGORIES.filter((item) => artisan.service_categories.includes(item.value));
  const [category, setCategory] = useState<ServiceCategory>(categories[0]?.value ?? 'electrical_repairs');
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const zoneGroups = groupZones(zones);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!artisan.is_available) { setError('This artisan is no longer available. Return to the profile list and choose an available provider.'); return; }
    if (!categories.some((item) => item.value === category)) { setError('Choose a service this artisan has listed.'); return; }
    if (!zoneId) { setError('Choose an active service zone.'); return; }
    if (files.length > MAX_IMAGES) { setError(`Choose no more than ${MAX_IMAGES} reference photos.`); return; }
    for (const file of files) {
      if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Reference photos must be JPG or PNG images.'); return; }
      if (file.size > MAX_BYTES) { setError('Each reference photo must be 8 MB or smaller.'); return; }
    }

    setBusy(true);
    try {
      const { data: request, error: createError } = await supabase.from('customer_requests').insert({
        customer_id: customer.id,
        target_artisan_id: artisan.user_id,
        service_category: category,
        zone_id: zoneId,
        title: title.trim(),
        description: description.trim(),
        status: 'open',
      }).select('id').single();
      if (createError) throw createError;

      const failedUploads: string[] = [];
      for (const file of files) {
        const extension = file.type === 'image/png' ? 'png' : 'jpg';
        const path = `request-attachments/${customer.id}/${request.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('fixmate-marketplace-media').upload(path, file, {
          upsert: false, contentType: file.type, cacheControl: '3600',
        });
        if (uploadError) { failedUploads.push(file.name); continue; }
        const { error: metadataError } = await supabase.from('customer_request_attachments').insert({
          request_id: request.id, uploaded_by: customer.id, storage_path: path,
        });
        if (metadataError) {
          await supabase.storage.from('fixmate-marketplace-media').remove([path]);
          failedUploads.push(file.name);
        }
      }
      onSubmitted(failedUploads.length ? `Your request was posted, but ${failedUploads.length} reference photo${failedUploads.length === 1 ? '' : 's'} could not be attached. You can still continue without them.` : undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The request could not be posted. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="direct-request-page">
    <Button variant="quiet" onClick={onBack}><ArrowLeft size={16} /> Back to profile</Button>
    <AppHeader eyebrow="DIRECT SERVICE REQUEST" title={`Request ${serviceLabel(category)} from ${artisan.display_name || 'this artisan'}`} detail="This request will be sent directly to the artisan you selected—not to the matching pool." />
    {!artisan.is_available && <Alert tone="info">This artisan is not currently accepting requests. Go back and choose an available provider.</Alert>}
    {error && <Alert>{error}</Alert>}
    <Card className="card-pad direct-request-card">
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <Field label="Selected artisan"><input readOnly value={artisan.display_name || 'Verified artisan'} /></Field>
        <Field label="Service"><select required value={category} onChange={(event) => setCategory(event.target.value as ServiceCategory)}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Service zone"><select required value={zoneId} onChange={(event) => setZoneId(event.target.value)}><option value="">Choose one zone</option>{zoneGroups.map(([group, items]) => <optgroup key={group} label={group}>{items.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</optgroup>)}</select></Field>
        <Field label="Short title"><input required minLength={3} maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Describe the job briefly" /></Field>
        <Field label="Describe the work"><textarea required minLength={10} maxLength={2500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explain the problem and what you need done." /></Field>
        <Field label="Reference photos (optional)" hint={`JPG or PNG · up to ${MAX_IMAGES} photos · maximum 8 MB each`}>
          <input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setError(''); }} />
        </Field>
        {files.length > 0 && <p className="field__hint">{files.length} photo{files.length === 1 ? '' : 's'} selected: {files.map((file) => file.name).join(', ')}</p>}
        <p className="form-footnote"><ImageIcon size={14} /> Photos are private and visible only to you, this artisan, and authorized FixMate administrators.</p>
        <Button type="submit" disabled={busy || !artisan.is_available || categories.length === 0}><Send size={15} /> {busy ? 'Adding request…' : 'Add Request'}</Button>
      </form>
    </Card>
  </section>;
}
