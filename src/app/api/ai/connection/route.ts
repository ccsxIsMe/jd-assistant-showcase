import { testDeepSeekConnection } from '@/lib/ai/adapter';
import { modelError } from '@/lib/ai/errors';
import { readConfig } from '@/lib/ai/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  try {
    const c = readConfig();
    return Response.json(
      {
        configured: c.mode === 'real' && !!c.apiKey && !!c.model,
        mode: c.mode,
        model: c.model ?? null,
        baseURL: c.baseURL,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    const err = modelError(e);
    return Response.json(
      { configured: false, code: err.code, message: err.message },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export async function POST(req: Request) {
  const requestId = randomUUID();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20000)]);
  try {
    const body = z
      .object({ confirm: z.literal(true) })
      .strict()
      .parse(await req.json());
    void body;
    const result = await testDeepSeekConnection(signal);
    return Response.json({ ...result, requestId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err =
      e instanceof z.ZodError
        ? {
            code: 'INVALID_INPUT',
            message: '请主动确认连接测试；此入口只接受固定测试，不接受岗位资料。',
            status: 422,
          }
        : modelError(e, signal);
    return Response.json(
      { ok: false, code: err.code, message: err.message, requestId },
      { status: err.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
