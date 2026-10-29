import { redirect } from 'next/navigation';
import { ExplorationHome } from '@/components/exploration/home';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; project?: string }>;
}) {
  const q = await searchParams;
  if (q.project && /^[a-zA-Z0-9_-]{1,150}$/.test(q.project)) redirect(`/explore/${q.project}`);
  if (q.view === 'classic') return <ExplorationHome />;
  redirect('/lab');
}
