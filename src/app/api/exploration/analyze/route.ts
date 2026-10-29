import { randomUUID } from 'node:crypto';
import { analysisRequestSchema } from '@/lib/exploration/analysis';
import { runExplorationAnalysis } from '@/lib/ai/exploration-service';
import { exploreRequirements } from '@/lib/ai/tasks/explore-requirements';
import { modelIdentity } from '@/lib/ai/model-identity';
import { PARSER_VERSIONS } from '@/lib/exploration/research';
import { readBoundedJSON, explorationError } from '@/lib/exploration/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const requestId = randomUUID();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  try {
    const input = analysisRequestSchema.parse(await readBoundedJSON(request));
    const output = await runExplorationAnalysis(input, signal);
    return Response.json(
      {
        output,
        requestId,
        promptVersion: exploreRequirements.promptVersion,
        projectId: input.projectId,
        baseRevision: input.revision,
        mode: input.mode,
        modelConfig: modelIdentity(input.mode),
        parserVersions: PARSER_VERSIONS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const response = explorationError(error, requestId, signal, 'ai');
    const diagnostic = await response.clone().json();
    console.warn(
      JSON.stringify({
        event: 'exploration_request_failed',
        requestId,
        code: diagnostic.code,
        status: response.status,
        attempts: diagnostic.attempts,
        validationIssues: diagnostic.validationIssues,
      }),
    );
    return response;
  }
}
