import { labTaskExamples } from '@/lib/lab/examples';
import {
  visionInputSchema,
  visionOutputSchema,
  visionPrompt,
  visionPromptVersion,
} from '@/lib/lab/vision-contract';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function GET() {
  return Response.json(
    {
      tasks: [
        ...labTaskExamples(),
        {
          name: 'lab.extract_image_evidence',
          promptVersion: visionPromptVersion,
          system: visionPrompt,
          inputSchema: z.toJSONSchema(visionInputSchema, { target: 'draft-7' }),
          outputSchema: z.toJSONSchema(visionOutputSchema, { target: 'draft-7' }),
          input: {
            projectId: 'synthetic-project',
            sourceId: 'synthetic-image',
            sourceRevision: 1,
            mode: 'example',
            consent: true,
            png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
            width: 1,
            height: 1,
          },
          output: {
            text: '',
            regions: [],
            limitations: ['演示数据，非真实AI分析。此空白图像没有可见文字。'],
          },
        },
      ],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
