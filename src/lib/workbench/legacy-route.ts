// Preserve useful bookmarked workspace context while merging obsolete standalone forms.
export function legacyWorkbenchDestination(
  q: Record<string, string | string[] | undefined>,
  view: 'jd' | 'tasks',
) {
  const raw = q.workspaceId ?? q.workspace ?? q.id;
  const id = typeof raw === 'string' && /^[a-zA-Z0-9:_-]{1,150}$/.test(raw) ? raw : null;
  return id ? `/workspaces/${encodeURIComponent(id)}?view=${view}` : '/#workspaces';
}
