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
