import { randomUUID } from 'node:crypto';
import { callDeepSeekJSON } from '@/lib/ai/adapter';
import {
  visionInputSchema,
  visionOutputSchema,
  visionPrompt,
  visionPromptVersion,
} from '@/lib/lab/vision-contract';
import { readBoundedJSON, explorationError } from '@/lib/exploration/http';
import { PublicError } from '@/lib/ai/config';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const requestId = randomUUID(),
    signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  try {
    const input = visionInputSchema.parse(await readBoundedJSON(request, 11500000));
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.png)) throw new PublicError('图像编码不合法。', 422);
    const bytes = Buffer.from(input.png, 'base64');
    if (bytes.length > 8 * 1024 * 1024) throw new PublicError('图像超过8MB限制。', 413);
    if (
      bytes.length < 33 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== input.width ||
      bytes.readUInt32BE(20) !== input.height
    )
      throw new PublicError('图像实际格式或尺寸不一致。', 422);
    const output =
      input.mode === 'example'
        ? {
            text: '',
            regions: [],
            limitations: [
              '演示数据，非真实AI分析。未识别这张图片，请使用演示案例已标明的候选框或手动补充。',
            ],
          }
        : await callDeepSeekJSON({
            schema: visionOutputSchema,
            system: visionPrompt,
            input: { task: 'extract_image_evidence', width: input.width, height: input.height },
            images: [{ data: bytes, mime: 'image/png' }],
            signal,
            maxTokens: 7000,
          });
    return Response.json(
      {
        output,
        requestId,
        sourceId: input.sourceId,
        sourceRevision: input.sourceRevision,
        projectId: input.projectId,
        mode: input.mode,
        promptVersion: visionPromptVersion,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const response = explorationError(error, requestId, signal, 'ai');
    const safe = await response.clone().json();
    console.warn(
      JSON.stringify({
        event: 'image_evidence_failed',
        requestId,
        code: safe.code,
        status: response.status,
      }),
    );
    return response;
  }
}
