import { WorkspaceView } from '@/components/workbench/workspace';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ target?: string; view?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  return (
    <WorkspaceView
      key={id}
      id={id}
      initialTarget={q.target}
      initialView={q.view === 'jd' ? 'jd' : q.view === 'tasks' ? 'tasks' : undefined}
    />
  );
}
