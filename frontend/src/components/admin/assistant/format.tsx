// Small formatters the assistant components share.

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

export const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

export function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// One line describing a tool call's input — the card's subtitle before the
// action's own summary exists.
export function inputSummary(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  const parts = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined && x !== null && x !== '')
    .map(([k, x]) => `${k}: ${typeof x === 'string' ? x : JSON.stringify(x)}`);
  const s = parts.join(' · ');
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}
