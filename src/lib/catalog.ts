import type { ServiceCategory, ServiceZone } from './types';

export const SERVICE_CATEGORIES: ReadonlyArray<{ value: ServiceCategory; label: string }> = [
  { value: 'electrical_repairs', label: 'Electrical repairs' },
  { value: 'phone_computer_repair', label: 'Phone and computer repair' },
  { value: 'errands', label: 'Errands' },
];

export const CUSTOMER_REVIEW_STATUSES = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  needs_more_info: 'More information needed',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export const ARTISAN_APPLICATION_STATUSES = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  needs_more_info: 'More information needed',
  approved: 'Approved',
  rejected: 'Not approved',
  suspended: 'Suspended',
  revoked: 'Revoked',
} as const;

export function groupZones(zones: ServiceZone[]): Array<[string, ServiceZone[]]> {
  const groups = new Map<string, ServiceZone[]>();
  for (const zone of [...zones].sort((a, b) => a.sort_order - b.sort_order)) {
    const list = groups.get(zone.zone_group) ?? [];
    list.push(zone);
    groups.set(zone.zone_group, list);
  }
  return [...groups.entries()];
}

export function cleanWhatsAppNumber(value: string): string {
  return value.trim().replace(/[^\d+]/g, '');
}

export function whatsAppDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  if (digits.startsWith('234')) return digits;
  return digits;
}

export function whatsAppLink(value: string, text?: string): string {
  const digits = whatsAppDigits(value);
  const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${suffix}`;
}

export function serviceLabel(value: ServiceCategory): string {
  return SERVICE_CATEGORIES.find((category) => category.value === value)?.label ?? 'Service';
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(new Date(value));
}

export function formatNaira(value: number | null): string {
  if (value === null) return 'Quote on request';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(value);
}
