import { LabSnapshot } from '@/components/lab/workspace';
export default async function Page({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  return <LabSnapshot id={snapshotId} />;
}
