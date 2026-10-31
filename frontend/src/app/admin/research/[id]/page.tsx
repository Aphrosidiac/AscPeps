import { ResearchEditor } from '@/components/admin/research/ResearchEditor';

interface Props {
  params: Promise<{ id: string }>;
}

/** /admin/research/new starts a blank draft; anything else is an article id. */
export default async function ResearchEditorPage({ params }: Props) {
  const { id } = await params;
  return <ResearchEditor id={id} />;
}
