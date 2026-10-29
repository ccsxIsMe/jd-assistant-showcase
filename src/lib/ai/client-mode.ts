import { z } from 'zod';
// Only public configuration status is read. Creating a workspace never calls a model.
export async function configuredClientMode(): Promise<'example' | 'real'> {
  const r = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!r.ok) return 'example';
  const d = z.object({ mode: z.enum(['mock', 'real']) }).parse(await r.json());
  return d.mode === 'real' ? 'real' : 'example';
}
