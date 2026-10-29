import { ResumeReviewWorkspace } from '@/components/resume/review-workspace';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const value = (key: string) => (typeof q[key] === 'string' ? (q[key] as string) : undefined);
  return (
    <ResumeReviewWorkspace
      key={`${value('review') ?? ''}:${value('workspaceId') ?? value('workspace') ?? ''}:${value('version') ?? ''}`}
      reviewId={value('review')}
      workspaceId={value('workspaceId') ?? value('workspace')}
      versionId={value('version')}
    />
  );
}
