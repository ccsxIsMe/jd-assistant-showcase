import 'server-only';
import { callDeepSeekJSON } from './adapter';
import { ModelError } from './errors';
import { resumeEvidenceTask } from './tasks/resume-evidence';
import { redactResume, resumeParagraphs, validateResumeOutput } from '../resume/domain';
import { mockResumeReview } from '../resume/mock';
import { resumeRequestSchema } from '../resume/model';
export async function runResumeReview(raw: unknown, signal: AbortSignal) {
  const input = resumeRequestSchema.parse(raw);
  input.material.text = redactResume(input.material.text);
  if (input.material.text.trim().length < 10)
    throw new ModelError('INVALID_INPUT', '简历职业经历文字不足，已有报告保留。', 422);
  if (
    input.standard.requirements.some((r) =>
      /性别|婚育|婚姻|民族|宗教|照片|年龄[限制要求]|[男女]性优先/.test(r.text),
    )
  )
    throw new ModelError('INVALID_INPUT', '请移除与岗位能力无关的个人属性条件后核对。', 422);
  for (let attempt = 0; attempt < (input.mode === 'example' ? 1 : 2); attempt++) {
    try {
      signal.throwIfAborted();
      const rawOutput =
        input.mode === 'example'
          ? mockResumeReview(input)
          : await callDeepSeekJSON({
              schema: resumeEvidenceTask.outputSchema,
              system:
                resumeEvidenceTask.system +
                (attempt
                  ? '\n前次引用或结构未通过，请逐字核对本次ID和段落，无法支持时保留未知。'
                  : ''),
              input: {
                standard: input.standard,
                paragraphs: resumeParagraphs(input.material.text),
              },
              signal,
              maxTokens: 10000,
            });
      return { input, data: validateResumeOutput(input, rawOutput) };
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof ModelError &&
          !['INVALID_FORMAT', 'INVALID_REFERENCE'].includes(error.code))
      )
        throw error;
      if (input.mode === 'example')
        throw new ModelError(
          'DEMO_OUT_OF_SCOPE',
          error instanceof Error ? error.message : '预置材料不适用，原数据保留。',
          422,
        );
      if (attempt === 1)
        throw new ModelError(
          'INVALID_REFERENCE',
          '简历结果未通过结构或引用校验；已有材料和人工修正保留，请重试。',
          422,
        );
    }
  }
  throw new ModelError('INVALID_FORMAT', '核对未完成，原数据保留。', 422);
}
