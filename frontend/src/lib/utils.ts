import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatPrice(priceInSen: number): string {
  return `RM${(priceInSen / 100).toFixed(2)}`;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Normalize Malaysian phone numbers to digits-only format: 01XXXXXXXXX
 * Handles: +60132719008, 60132719008, 013-271 9008, 013 271 9008, etc.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('60') && digits.length >= 10 && digits.length <= 12) {
    return '0' + digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 11) {
    return digits;
  }
  return digits || raw.trim();
}
