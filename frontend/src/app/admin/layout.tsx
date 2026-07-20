import type { Metadata } from 'next';
import { AdminLayoutClient } from './AdminLayoutClient';

// The admin panel must never be indexed. The interactive layout is a client
// component (AdminLayoutClient), which can't export metadata — so this thin
// server layout owns the segment's metadata and delegates rendering.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
