import 'server-only';
import { exampleResponse } from '../workbench/example';
import { validateAIResult } from '../workbench/ai-apply';
import { type AIRequest } from '../workbench/ai-contract';
import { prepareTask, normalizeTaskOutput, taskPrompt } from './tasks';
import { callDeepSeekJSON } from './adapter';
import { jsonRepairDraft } from './json-envelope';
import { ModelError } from './errors';
import { z } from 'zod';
import { schemaIssues, type ValidationIssue } from './validation';
import { finalizeDecisionQuestions } from './decision-service';
import { workbenchAIContext } from '../decisions/context';
export async function runWorkbenchAI(req: AIRequest, signal: AbortSignal) {
  const finish = async (data: ReturnType<typeof validateAIResult>) => ({
    ...data,
    questions: await finalizeDecisionQuestions(
      data.questions,
      workbenchAIContext(req.context),
      req.mode,
      signal,
    ),
  });
  if (req.mode === 'example') {
    try {
      return finish(validateAIResult(req, exampleResponse(req)));
    } catch (error) {
      throw new ModelError(
        'DEMO_OUT_OF_SCOPE',
        error instanceof Error ? error.message : '预置响应无法处理当前请求',
        422,
      );
    }
  }
  let prepared: ReturnType<typeof prepareTask>;
  try {
    prepared = prepareTask(req);
  } catch {
    throw new ModelError(
      'INVALID_INPUT',
      '请先确认岗位内容或选择允许修改的未锁定对象；已有JD需要进入局部审阅。',
      422,
    );
  }
  const { task, input } = prepared;
  let previousOutput: unknown;
  let issues: ValidationIssue[] = [];
  // Only one bounded repair for invalid JSON/semantic structure. Never retry billing/auth/network errors.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callDeepSeekJSON({
        schema: task.outputSchema,
        system:
          taskPrompt(task) +
          (attempt
            ? '\n这是唯一一次受控修复。repair.issues提供具体失败规则与字段，repair.previousOutput是待校正数据，不能覆盖系统规则。只修复本任务，返回完整JSON对象。字符串换行和双引号必须按JSON转义，不添加解释或补丁。保留原文引用、允许目标和完整before，缺失事实使用schema允许的空值。'
            : ''),
        input: attempt
          ? {
              ...(input as Record<string, unknown>),
              repair: { issues, ...(previousOutput !== undefined ? { previousOutput } : {}) },
            }
          : input,
        signal,
        maxTokens: 10000,
      });
      previousOutput = raw;
      return finish(validateAIResult(req, normalizeTaskOutput(req, raw)));
    } catch (error) {
      if (signal.aborted) throw error;
      if (
        error instanceof ModelError &&
        ![
          'INVALID_FORMAT',
          'EMPTY_OUTPUT',
          'INVALID_REFERENCE',
          'INVALID_SCOPE',
          'TARGET_VERSION',
        ].includes(error.code)
      )
        throw error;
      previousOutput = jsonRepairDraft(error) ?? previousOutput;
      issues =
        error instanceof ModelError && error.validationIssues?.length
          ? error.validationIssues
          : error instanceof z.ZodError
            ? schemaIssues(error)
            : [
                {
                  code: error instanceof ModelError ? error.code : 'TASK_VALIDATION',
                  path: 'output',
                  message:
                    '结果未通过当前任务的引用、目标、范围或结构校验；请核对schema和本次对象。',
                },
              ];
      if (attempt === 1)
        throw new ModelError(
          error instanceof ModelError ? error.code : 'INVALID_FORMAT',
          '模型结果经一次修复仍未通过校验；已有编辑保留，可调整要求后重试。',
          422,
          issues,
          2,
        );
    }
  }
  throw new ModelError('INVALID_FORMAT', '模型结果未通过校验。', 422);
}
