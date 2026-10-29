import { createHash, randomUUID } from 'node:crypto';
import { repairDecisionRequestSchema } from '@/lib/decisions/contracts';
import { repairQuestionBatch, type DecisionRepairResult } from '@/lib/ai/decision-service';
import { readBoundedJSON, explorationError } from '@/lib/exploration/http';
import { ModelError } from '@/lib/ai/errors';
export const runtime = 'nodejs';
const pending = new Map<
  string,
  { signature: string; expires: number; promise: Promise<DecisionRepairResult> }
>();
const active = new Map<string, Promise<DecisionRepairResult>>();
export async function POST(request: Request) {
  const requestId = randomUUID(),
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  try {
    const input = repairDecisionRequestSchema.parse(await readBoundedJSON(request));
    const key = `${input.context.id}:${input.operationId}`,
      signature = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const now = Date.now();
    for (const [id, v] of pending) if (v.expires < now) pending.delete(id);
    const prior = pending.get(key);
    if (prior && prior.signature !== signature)
      throw new ModelError('VERSION_CONFLICT', '请求编号已用于其他版本，请重新发起本题补全。', 409);
    if (pending.size > 100)
      throw new ModelError('RATE_LIMIT', '当前补全请求较多，请稍后重试。', 429);
    const workKey = createHash('sha256')
      .update(JSON.stringify([input.mode, input.context, input.question]))
      .digest('hex');
    const promise =
      prior?.promise ??
      active.get(workKey) ??
      repairQuestionBatch(
        [{ id: input.question.id, question: input.question }],
        input.context,
        input.mode,
        signal,
      ).then((map) => map.get(input.question.id)!);
    if (!active.has(workKey)) {
      active.set(workKey, promise);
      void promise.then(
        () => active.delete(workKey),
        () => active.delete(workKey),
      );
    }
    if (!prior) pending.set(key, { signature, expires: now + 120000, promise });
    const result = await promise;
    return Response.json(
      {
        ...result,
        requestId,
        operationId: input.operationId,
        questionId: input.question.id,
        contextId: input.context.id,
        ok: result.questions.length > 0,
      },
      { status: result.questions.length ? 200 : 422, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return explorationError(error, requestId, signal, 'ai');
  }
}
