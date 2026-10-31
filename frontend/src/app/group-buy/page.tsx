import { getGroupBuysServer } from '@/lib/server-api';
import { BatchesClient } from './BatchesClient';

export const metadata = {
  title: 'Group Buy',
  alternates: { canonical: 'https://ascendpeptides.my/group-buy' },
};

export default async function GroupBuyIndexPage() {
  const batches = await getGroupBuysServer();
  return <BatchesClient batches={batches} />;
}
