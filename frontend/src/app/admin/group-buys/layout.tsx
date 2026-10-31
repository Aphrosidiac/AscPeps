import { notFound } from 'next/navigation';
import { GROUP_BUY_ENABLED } from '@/lib/features';

export default function GroupBuysAdminLayout({ children }: { children: React.ReactNode }) {
  if (!GROUP_BUY_ENABLED) notFound();
  return children;
}
