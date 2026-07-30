import { PartnerLedger } from './PartnerLedger';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminPartnerPage({ params }: Props) {
  const { id } = await params;
  return <PartnerLedger partnerId={id} />;
}
