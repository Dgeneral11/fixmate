import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MapPin, MessageCircle, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, AppHeader, Button, Card, Field, LoadingState } from '../../components/ui';
import { WhatsAppSupport } from '../../components/WhatsAppSupport';
import { cleanWhatsAppNumber, groupZones, whatsAppLink } from '../../lib/catalog';
import type { ServiceZone } from '../../lib/types';

export function AdminContactAndZones({ supabase }: { supabase: SupabaseClient }) {
  const [number, setNumber] = useState('08144196124');
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const [contactResult, zoneResult] = await Promise.all([
      supabase.from('fixmate_contact_settings').select('support_whatsapp_number').eq('id', 1).maybeSingle(),
      supabase.from('pilot_service_zones').select('id, zone_group, name, sort_order, is_active').order('sort_order'),
    ]);
    const firstError = contactResult.error ?? zoneResult.error;
    if (firstError) setError(firstError.message);
    if (contactResult.data?.support_whatsapp_number) setNumber(contactResult.data.support_whatsapp_number);
    setZones((zoneResult.data ?? []) as ServiceZone[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [supabase]);
  const grouped = useMemo(() => groupZones(zones), [zones]);

  async function saveNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const clean = cleanWhatsAppNumber(number);
    if (!/^\+?[0-9]{10,15}$/.test(clean)) { setError('Enter a valid WhatsApp number with 10–15 digits.'); return; }
    setBusy(true);
    const { error: updateError } = await supabase.from('fixmate_contact_settings').update({ support_whatsapp_number: clean }).eq('id', 1);
    if (updateError) setError(updateError.message);
    else { setNumber(clean); setNotice('FixMate support contact saved. Links now open WhatsApp without sending automatically.'); }
    setBusy(false);
  }

  async function toggleZone(zone: ServiceZone) {
    setBusy(true);
    setError('');
    setNotice('');
    const { error: updateError } = await supabase.from('pilot_service_zones').update({ is_active: !zone.is_active }).eq('id', zone.id);
    if (updateError) setError(updateError.message);
    else await load();
    setBusy(false);
  }

  if (loading) return <LoadingState label="Loading administrator settings…" />;
  return <>
    <AppHeader eyebrow="ADMINISTRATOR PROFILE" title="Support contact & pilot zones" detail="The WhatsApp contact is stored in FixMate settings. Zone names are proposed service areas, not verified map pins." />
    {error && <Alert>{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    <div className="section-grid">
      <Card className="card-pad"><div className="card-heading"><div><p className="eyebrow">FIXMATE WHATSAPP</p><h2>Administrator support contact</h2><p>Support line shown on account and review screens.</p></div><span className="service-card__icon"><MessageCircle size={19} /></span></div>
        <form className="form-stack" onSubmit={saveNumber}><Field label="WhatsApp number"><input type="tel" required value={number} onChange={(event) => setNumber(event.target.value)} placeholder="08144196124" /></Field><Button type="submit" disabled={busy}><Save size={15} /> Save contact number</Button></form>
        <div className="admin-contact-preview"><span className="field__hint">Current number</span><strong>{number}</strong><a href={whatsAppLink(number, 'Hello FixMate, I need help.')} target="_blank" rel="noreferrer" className="inline-link">Open WhatsApp draft <MessageCircle size={14} /></a></div>
        <WhatsAppSupport supabase={supabase} label="Test support link" message="Hello FixMate, I need help." />
      </Card>
      <Card className="card-pad"><p className="eyebrow">PILOT COVERAGE</p><h2>ABU Main Campus only</h2><p className="muted">Toggle whether a zone is currently available for customer requests and artisan matching. No map coordinates are stored.</p><div className="zone-switch-list">{grouped.map(([group, items]) => <section key={group} className="zone-checkbox-group"><h4>{group}</h4>{items.map((zone) => <div className="zone-switch" key={zone.id}><span><MapPin size={14} />{zone.name}</span><button type="button" disabled={busy} aria-pressed={zone.is_active} onClick={() => void toggleZone(zone)} className={`switch-button${zone.is_active ? ' is-on' : ''}`}>{zone.is_active ? <ToggleRight size={23} /> : <ToggleLeft size={23} />}<small>{zone.is_active ? 'Active' : 'Paused'}</small></button></div>)}</section>)}</div>
      </Card>
    </div>
  </>;
}
