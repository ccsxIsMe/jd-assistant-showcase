import { redirect } from 'next/navigation';
import { legacyWorkbenchDestination } from '@/lib/workbench/legacy-route';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(legacyWorkbenchDestination(await searchParams, 'tasks'));
}
