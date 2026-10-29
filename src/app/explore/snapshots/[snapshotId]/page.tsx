import { SnapshotDetail } from '@/components/exploration/snapshots';
export default async function Page({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  return <SnapshotDetail id={snapshotId} />;
}
