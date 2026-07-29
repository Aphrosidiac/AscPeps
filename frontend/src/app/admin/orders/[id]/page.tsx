import { OrderDetail } from './OrderDetail';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminOrderDetailPage({ params }: Props) {
  const { id } = await params;
  return <OrderDetail orderId={id} />;
}
