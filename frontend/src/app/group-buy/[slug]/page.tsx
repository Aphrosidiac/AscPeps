import type { Metadata } from 'next';
import { getGroupBuyServer } from '@/lib/server-api';
import { BatchClient, DraftPreview } from './BatchClient';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const gb = await getGroupBuyServer(slug);
  if (!gb) return { title: 'Group Buy' };
  return {
    title: `${gb.title} (${gb.label})`,
    description: gb.tagline || `Group Buy ${gb.label}: wholesale tier pricing until ${new Date(gb.closesAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long' })}.`,
    alternates: { canonical: `https://ascendpeptides.my/group-buy/${gb.slug}` },
    openGraph: gb.heroImageUrl ? { images: [gb.heroImageUrl] } : undefined,
  };
}

export default async function GroupBuyBatchPage({ params }: Props) {
  const { slug } = await params;
  const gb = await getGroupBuyServer(slug);
  // A draft is invisible to the public; the team previews it with their admin
  // token, which only the browser holds.
  if (!gb) return <DraftPreview slug={slug} />;
  return <BatchClient initial={gb} />;
}
