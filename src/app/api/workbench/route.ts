import { workbenchRequest } from '@/lib/workbench/ai-contract';
import { runWorkbenchAI } from '@/lib/ai/workbench-service';
import { PublicError } from '@/lib/ai/config';
import { ZodError } from 'zod';
import { modelError } from '@/lib/ai/errors';
import { randomUUID } from 'node:crypto';
import { taskRegistry, taskNameForAction } from '@/lib/ai/tasks';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const requestId = randomUUID();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(60000)]);
  let action = 'unknown';
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new PublicError('请求不能为空', 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1000000)
          throw new PublicError('工作区资料超过单次分析限制，请减少相关材料后重试。', 413);
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new PublicError('无效JSON', 400);
    }
    const input = workbenchRequest.parse(json);
    action = input.action;
    const data = await runWorkbenchAI(input, signal);
    const task = taskRegistry[taskNameForAction[input.action]];
    return Response.json(
      {
        mode: input.mode,
        data,
        requestId,
        task: task.name,
        promptVersion: task.promptVersion,
        workspaceId: input.context.id,
        baseRevision: input.context.revision,
        targetVersions: input.context.items.map((i) => ({ id: i.id, revision: i.revision })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const safe = modelError(error, signal);
    const status = signal.aborted
      ? 408
      : error instanceof PublicError
        ? error.status
        : error instanceof ZodError
          ? 422
          : safe.status;
    const message = signal.aborted
      ? '请求取消或超时，可重试。'
      : error instanceof PublicError
        ? error.message
        : error instanceof ZodError
          ? '输入或模型结构校验失败，未修改工作区。'
          : safe.message;
    const code = error instanceof ZodError ? 'INVALID_INPUT' : safe.code;
    // Diagnostics deliberately contain no input, output, credentials or raw provider error.
    console.warn(
      JSON.stringify({
        event: 'workbench_request_failed',
        requestId,
        action,
        code,
        status,
        ...(safe.attempts ? { attempts: safe.attempts } : {}),
        ...(safe.validationIssues?.length
          ? { issues: safe.validationIssues.map(({ code, path }) => ({ code, path })) }
          : {}),
      }),
    );
    return Response.json(
      {
        error: message,
        code,
        requestId,
        ...(safe.validationIssues?.length ? { validationIssues: safe.validationIssues } : {}),
        ...(safe.attempts ? { attempts: safe.attempts } : {}),
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
