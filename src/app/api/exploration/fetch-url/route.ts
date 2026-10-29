import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fetchPublicPage } from '@/lib/exploration/web';
import { readBoundedJSON, explorationError } from '@/lib/exploration/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const requestId = randomUUID();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
  try {
    const { url } = z
      .object({ url: z.string().min(1).max(2000) })
      .strict()
      .parse(await readBoundedJSON(request, 12000));
    return Response.json(
      { ...(await fetchPublicPage(url, signal)), requestId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return explorationError(error, requestId, signal, 'web');
  }
}
