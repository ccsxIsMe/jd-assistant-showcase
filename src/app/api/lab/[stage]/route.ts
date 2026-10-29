import { randomUUID } from 'node:crypto';
import { labStageRequestSchema } from '@/lib/lab/ai-contract';
import { runLabStage } from '@/lib/ai/lab-service';
import { labTasks } from '@/lib/ai/tasks/lab-stages';
import { readBoundedJSON, explorationError } from '@/lib/exploration/http';
import { modelIdentity } from '@/lib/ai/model-identity';
import { PublicError } from '@/lib/ai/config';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ stage: string }> }) {
  const requestId = randomUUID(),
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  try {
    const { stage } = await context.params;
    const input = labStageRequestSchema.parse(await readBoundedJSON(request));
    if (stage !== input.stage) throw new PublicError('阶段路径与请求不一致。', 422);
    const result = await runLabStage(input, signal);
    return Response.json(
      {
        ...result,
        requestId,
        projectId: input.projectId,
        baseRevision: input.revision,
        inputVersions: input.inputVersions,
        promptVersion: labTasks[input.stage].promptVersion,
        mode: input.mode,
        modelConfig: modelIdentity(input.mode),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const response = explorationError(error, requestId, signal, 'ai');
    const safe = await response.clone().json();
    console.warn(
      JSON.stringify({
        event: 'lab_stage_failed',
        requestId,
        code: safe.code,
        status: response.status,
        validationIssues: safe.validationIssues,
      }),
    );
    return response;
  }
}
