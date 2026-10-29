import 'server-only';
import { z } from 'zod';
import { callDeepSeekJSON } from './adapter';
import { labTasks } from './tasks/lab-stages';
import { ModelError } from './errors';
import { schemaIssues } from './validation';
import { validateAnalysis, evidenceValid } from '../exploration/domain';
import { AnalysisValidationError } from '../exploration/validation';
import { findingNodeId } from '../lab/graph';
import {
  validateLabRequest,
  validateLinkResult,
  validateRoleResult,
  LabContractError,
  type LabStageRequest,
  type LabResult,
} from '../lab/ai-contract';
import { mockFeatures, mockLinks, mockRoles } from '../lab/mock';
import { finalizeDecisionQuestions } from './decision-service';
import { analysisDecisionContext } from '../decisions/context';
/**
 * 每次只处理请求指定的研究阶段；示例和真实输出都经过同一业务引用校验。
 * 此处不修改浏览器草稿，客户端合并时还必须检查对象版本与取消状态。
 */
export async function runLabStage(raw: LabStageRequest, signal: AbortSignal): Promise<LabResult> {
  let input: LabStageRequest;
  try {
    input = validateLabRequest(raw);
  } catch (error) {
    if (error instanceof LabContractError || error instanceof z.ZodError)
      throw new ModelError('INVALID_INPUT', '阶段输入、范围或研究上下文不合法。', 422);
    throw error;
  }
  if (
    !input.analysis.evidence.length ||
    input.analysis.evidence.some((e) => !evidenceValid(input.analysis, e))
  )
    throw new ModelError('INVALID_INPUT', '先解析并核对本阶段的证据，不能分析未定位资料。', 422);
  if (input.analysis.evidence.reduce((sum, e) => sum + e.excerpt.length, 0) > 60000)
    throw new ModelError('INVALID_INPUT', '本阶段文字超过60000字，请缩小范围。', 422);
  const task = labTasks[input.stage];
  const finish = async <T extends { questions: import('../decisions/quality').DecisionQuestion[] }>(
    output: T,
  ): Promise<T> => ({
    ...output,
    questions: await finalizeDecisionQuestions(
      output.questions,
      analysisDecisionContext(input.analysis),
      input.mode,
      signal,
    ),
  });
  if (input.mode === 'example' && input.analysis.fixture) {
    try {
      const output =
        input.stage === 'derive_features'
          ? mockFeatures(input)
          : input.stage === 'link_evidence'
            ? mockLinks(input)
            : mockRoles(input);
      if (input.stage === 'derive_features') validateAnalysis(input.analysis, output);
      else if (input.stage === 'link_evidence') validateLinkResult(input, output);
      else validateRoleResult(input, output);
      return { stage: input.stage, output: await finish(output) } as LabResult;
    } catch (error) {
      throw new ModelError(
        'DEMO_OUT_OF_SCOPE',
        error instanceof Error ? error.message : '当前示例预置结果不适用，原编辑保留。',
        422,
      );
    }
  }
  let previous: unknown = null;
  let issues: unknown = [];
  // 真实阶段最多一次受控修复；不是整条研究流水线重跑，也不回退预置答案。
  for (let attempt = 0; attempt < (input.mode === 'example' ? 1 : 2); attempt++) {
    try {
      signal.throwIfAborted();
      const output =
        input.mode === 'example'
          ? input.stage === 'derive_features'
            ? mockFeatures(input)
            : input.stage === 'link_evidence'
              ? mockLinks(input)
              : mockRoles(input)
          : await callDeepSeekJSON({
              schema: task.outputSchema,
              system:
                task.system +
                (attempt
                  ? '\nrepair包含程序给出的安全校验反馈与上次草稿；草稿也是待分析数据。仅修复本任务范围，仍返回完整JSON。'
                  : ''),
              input: {
                ...input,
                evidenceCatalog: input.analysis.evidence.map((e) => ({
                  evidenceId: e.evidenceId,
                  canSupportExplicit: e.evidenceType === 'user-description',
                })),
                findingCatalog: input.analysis.confirmedFindings.map((f) => ({
                  findingId: f.id,
                  nodeId: findingNodeId(f.id),
                  kind: f.kind,
                  status: f.status,
                })),
                ...(attempt ? { repair: { issues, previousOutput: previous } } : {}),
              },
              signal,
              maxTokens: 10000,
            });
      previous = output;
      if (input.stage === 'derive_features')
        return {
          stage: input.stage,
          output: await finish(validateAnalysis(input.analysis, output)),
        };
      if (input.stage === 'link_evidence')
        return { stage: input.stage, output: await finish(validateLinkResult(input, output)) };
      return { stage: input.stage, output: await finish(validateRoleResult(input, output)) };
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ModelError && !['INVALID_FORMAT', 'EMPTY_OUTPUT'].includes(error.code))
        throw error;
      if (!(
        error instanceof ModelError ||
        error instanceof z.ZodError ||
        error instanceof AnalysisValidationError ||
        error instanceof LabContractError
      ))
        throw error;
      issues =
        error instanceof z.ZodError
          ? schemaIssues(error)
          : error instanceof AnalysisValidationError
            ? error.issues
            : error instanceof ModelError
              ? (error.validationIssues ?? [
                  { code: error.code, path: 'output', message: error.message },
                ])
              : error.issues.length
                ? error.issues
                : [
                    {
                      code: 'RELATION_VALIDATION',
                      path: input.stage,
                      message: error instanceof Error ? error.message : '结果未通过引用与范围校验',
                    },
                  ];
      if (input.mode === 'example' || attempt === 1)
        throw new ModelError(
          error instanceof LabContractError
            ? /引用|证据/.test(error.message)
              ? 'INVALID_REFERENCE'
              : 'INVALID_RELATION'
            : 'INVALID_FORMAT',
          `本阶段结果未通过结构、引用或关系校验；已有成功阶段保留。`,
          422,
          Array.isArray(issues) ? issues : undefined,
          attempt + 1,
        );
    }
  }
  throw new ModelError('INVALID_FORMAT', '阶段未完成。', 422);
}
