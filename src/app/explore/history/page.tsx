import { SnapshotHistory } from '@/components/exploration/snapshots';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const search = await searchParams;
  return <SnapshotHistory projectId={search.project} />;
}
