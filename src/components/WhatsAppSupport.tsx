import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { whatsAppLink } from '../lib/catalog';
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh';

export function useSupportWhatsApp(supabase: SupabaseClient): string {
  const [number, setNumber] = useState('08144196124');
  async function loadNumber() {
    const { data } = await supabase.from('fixmate_contact_settings').select('support_whatsapp_number').eq('id', 1).maybeSingle();
    if (data?.support_whatsapp_number) setNumber(data.support_whatsapp_number);
  }

  useRealtimeRefresh({
    supabase,
    identity: 'support-setting',
    scope: 'support-whatsapp',
    tables: [{ table: 'fixmate_contact_settings', filter: 'id=eq.1' }],
    onChange: loadNumber,
  });

  useEffect(() => {
    void loadNumber();
  }, [supabase]);
  return number;
}

export function WhatsAppSupport({ supabase, label = 'Contact FixMate on WhatsApp', message = 'Hello FixMate, I need help with my account.', className = 'button button--secondary' }: {
  supabase: SupabaseClient;
  label?: string;
  message?: string;
  className?: string;
}) {
  const number = useSupportWhatsApp(supabase);
  return <a className={className} href={whatsAppLink(number, message)} target="_blank" rel="noreferrer"><MessageCircle size={16} />{label}</a>;
}
