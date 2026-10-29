import { SnapshotHistory } from '@/components/exploration/snapshots';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return <SnapshotHistory projectId={project} />;
}
