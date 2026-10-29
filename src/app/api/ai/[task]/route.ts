import { z } from 'zod';
import { inputs, taskSchema } from '@/lib/schemas';
import { PublicError, readConfig } from '@/lib/ai/config';
import { generateJD, structured } from '@/lib/ai/service';
export const runtime = 'nodejs';
const MAX_BODY = 250000;
function failure(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return { error: '请求已取消或处理超时，请修改后重试。', status: 408 };
  if (error instanceof PublicError) return { error: error.message, status: error.status };
  if (error instanceof z.ZodError)
    return { error: '输入或模型结果不符合校验规则，请检查内容后重试。', status: 422 };
  return { error: 'AI调用失败或返回结构不合法，请检查服务端配置与网络后重试。', status: 502 };
}
async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new PublicError('请求体不能为空。', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) throw new PublicError('请求内容过大。', 413);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new PublicError('请求必须为有效JSON。', 400);
  }
}
export async function POST(req: Request, ctx: { params: Promise<{ task: string }> }) {
  const connection = new AbortController();
  const signal = AbortSignal.any([req.signal, connection.signal, AbortSignal.timeout(60000)]);
  try {
    const task = taskSchema.safeParse((await ctx.params).task);
    if (!task.success) throw new PublicError('接口不存在。', 404);
    const data = inputs[task.data].parse(await readBody(req));
    const { mode } = readConfig();
    if (task.data !== 'generate')
      return Response.json(
        { mode, data: await structured(task.data, data, signal) },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (v: unknown) => {
          if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(v) + '\n'));
        };
        try {
          for await (const text of generateJD(data, signal)) {
            if (cancelled) break;
            emit({ type: 'delta', text });
          }
          emit({ type: 'done' });
        } catch (error) {
          emit({ type: 'error', message: failure(error, signal).error });
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        connection.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-AI-Mode': mode,
      },
    });
  } catch (error) {
    const f = failure(error, signal);
    return Response.json(
      { error: f.error },
      { status: f.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
