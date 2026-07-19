import { InsightForm } from '../InsightForm';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditInsightPage({ params }: Props) {
  const { id } = await params;
  return <InsightForm insightId={id} />;
}
