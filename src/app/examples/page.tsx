import { DemoHub } from '@/components/examples/demo-hub';
import type { DemoStage } from '@/lib/demo/instances';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { stage } = await searchParams;
  const allowed = ['plan', 'research', 'board', 'workbench', 'resume', 'history'];
  return <DemoHub stage={stage && allowed.includes(stage) ? (stage as DemoStage) : undefined} />;
}
