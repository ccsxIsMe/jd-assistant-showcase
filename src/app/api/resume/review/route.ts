import { randomUUID } from 'node:crypto';
import { runResumeReview } from '@/lib/ai/resume-service';
import { resumeEvidenceTask } from '@/lib/ai/tasks/resume-evidence';
import { readBoundedJSON, explorationError } from '@/lib/exploration/http';
import { materialSignature } from '@/lib/resume/domain';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const requestId = randomUUID(),
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  try {
    const { input, data } = await runResumeReview(await readBoundedJSON(request, 750000), signal);
    return Response.json(
      {
        requestId,
        sessionId: input.sessionId,
        standardSignature: input.standard.signature,
        materialSignature: materialSignature(input.material.text),
        mode: input.mode,
        promptVersion: resumeEvidenceTask.promptVersion,
        modelConfigId: input.mode === 'example' ? 'preset-no-model-call' : 'configured-deepseek',
        data,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return explorationError(error, requestId, signal, 'ai');
  }
}
