import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { whatsAppLink } from '../lib/catalog';

export function useSupportWhatsApp(supabase: SupabaseClient): string {
  const [number, setNumber] = useState('08144196124');
  useEffect(() => {
    let alive = true;
    supabase.from('fixmate_contact_settings').select('support_whatsapp_number').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (alive && data?.support_whatsapp_number) setNumber(data.support_whatsapp_number);
      });
    return () => { alive = false; };
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
