import { randomUUID } from 'node:crypto';
import { probeAiNetwork } from '@/lib/ai/network-probe';
import { modelError, transportFailure } from '@/lib/ai/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const requestId = randomUUID(),
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  try {
    return Response.json(
      { ...(await probeAiNetwork(signal)), requestId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const safe = modelError(error, signal);
    console.warn(
      JSON.stringify({
        event: 'ai_network_probe_failed',
        requestId,
        code: safe.code,
        transportCode: transportFailure(error) ?? null,
      }),
    );
    return Response.json(
      { ok: false, code: safe.code, message: safe.message, requestId },
      { status: safe.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
