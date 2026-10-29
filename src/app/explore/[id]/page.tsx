import { ExplorationWorkspace } from '@/components/exploration/workspace';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entry?: string; evidence?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  return <ExplorationWorkspace id={id} entry={search.entry} initialEvidence={search.evidence} />;
}
