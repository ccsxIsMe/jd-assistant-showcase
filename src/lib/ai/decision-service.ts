import 'server-only';
import { callDeepSeekJSON } from './adapter';
import { decisionRepairOutputSchema, type DecisionContext } from '../decisions/contracts';
import {
  businessChoices,
  decisionSettled,
  initializeDecision,
  inspectDecision,
  normalizeDecisionOutput,
  normalizeText,
  stableDecisionId,
  type DecisionQuestion,
  sameDecisionTopic,
} from '../decisions/quality';
import { decisionOptionsPromptVersion, decisionRepairPrompt } from './tasks/decision-options';
import { ModelError } from './errors';
export type DecisionRepairResult = {
  questions: DecisionQuestion[];
  issues: string[];
  promptVersion: string;
  code?: string;
};
/** 推荐不是事实：只有引用能在本次资料或已有答案中定位，才保留相应来源标签。 */
function validateQuestion(q: DecisionQuestion, context: DecisionContext): DecisionQuestion {
  const copy = initializeDecision(q);
  if (
    copy.recommendation &&
    /(\d+\s*%.*(适合|推荐|概率)|(适合|推荐|概率).*\d+\s*%)/.test(copy.recommendation.reason)
  )
    delete copy.recommendation;
  if (copy.recommendation && !copy.choices?.some((c) => c.id === copy.recommendation!.choiceId))
    delete copy.recommendation;
  copy.choices = copy.choices?.map((c) => {
    const supported =
      c.reference &&
      context.facts.some(
        (f) =>
          f.id === c.reference!.id &&
          f.text.includes(c.reference!.quote) &&
          c.reference!.quote.trim().length >= 2,
      );
    const answered =
      c.reference &&
      context.answers.some(
        (a) => a.id === c.reference!.id && a.answer.includes(c.reference!.quote),
      );
    return {
      ...c,
      sourceType: (supported ? 'user_material' : answered ? 'existing_answer' : 'ai_suggestion') as
        'user_material' | 'existing_answer' | 'ai_suggestion',
      ...(!supported && !answered ? { reference: undefined } : {}),
    };
  });
  const known = copy.decisionSpec?.knownAnswer;
  if (
    known &&
    context.facts.some(
      (f) =>
        f.id === known.referenceId &&
        known.quote.trim().length >= 2 &&
        f.text.includes(known.quote) &&
        normalizeText(known.quote).includes(normalizeText(known.text)),
    )
  ) {
    copy.decision!.generation = 'known';
    copy.decision!.issues = [];
  } else if (known) {
    delete copy.decisionSpec!.knownAnswer;
  }
  return copy;
}
/** 单次最多补全三题；失败保留显式错误，不用辅助按钮冒充业务选项。 */
export async function repairQuestionBatch(
  targets: { id: string; question: DecisionQuestion }[],
  context: DecisionContext,
  mode: 'real' | 'example',
  signal: AbortSignal,
): Promise<Map<string, DecisionRepairResult>> {
  const result = new Map<string, DecisionRepairResult>();
  for (const t of targets)
    result.set(t.id, {
      questions: [],
      issues: ['该问题的可选方案尚未生成完成。'],
      promptVersion: decisionOptionsPromptVersion,
    });
  if (mode === 'example') {
    for (const v of result.values())
      v.issues = ['示例模式没有该问题的预置补全，保留未知或直接补充；真实补全需主动切换真实模式。'];
    return result;
  }
  try {
    signal.throwIfAborted();
    const repairSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    const raw = await callDeepSeekJSON({
      schema: decisionRepairOutputSchema,
      system: decisionRepairPrompt,
      input: {
        context,
        targets: targets.slice(0, 3).map((t) => ({
          targetId: t.id,
          question: t.question,
          issues: inspectDecision(t.question).issues,
        })),
        excludedOptions: context.answers
          .filter(
            (a) =>
              a.response?.kind === 'none' && targets.some((t) => sameDecisionTopic(a, t.question)),
          )
          .map((a) => ({
            title: a.title,
            optionsVersion: a.response!.optionsVersion,
            choices: a.response!.optionSnapshot,
          })),
      },
      signal: repairSignal,
      maxTokens: 5000,
    });
    const output = decisionRepairOutputSchema.parse(normalizeDecisionOutput(raw));
    const ids = new Set<string>();
    for (const patch of output.patches) {
      if (!targets.some((t) => t.id === patch.targetId) || ids.has(patch.targetId))
        throw new Error('补全目标不合法或重复。');
      ids.add(patch.targetId);
      const questions = patch.questions.map((q) => validateQuestion(q, context));
      if (questions.some((q) => !inspectDecision(q).ready)) continue;
      const rejected = context.answers
        .filter(
          (a) =>
            a.response?.kind === 'none' &&
            sameDecisionTopic(a, targets.find((t) => t.id === patch.targetId)!.question),
        )
        .flatMap((a) => a.response?.optionSnapshot ?? []);
      if (
        questions.some(
          (q) =>
            businessChoices(q.choices).length > 0 &&
            businessChoices(q.choices).every((c) =>
              rejected.some((old) => normalizeText(old.label) === normalizeText(c.label)),
            ),
        )
      )
        continue;
      result.set(patch.targetId, {
        questions,
        issues: [],
        promptVersion: decisionOptionsPromptVersion,
      });
    }
  } catch (error) {
    if (signal.aborted) throw error;
    for (const value of result.values()) {
      value.issues = [
        error instanceof ModelError
          ? error.message
          : '选项补全失败；已有内容保留，可局部重试或保留未知继续方案。',
      ];
      value.code = error instanceof ModelError ? error.code : 'INVALID_OPTIONS';
    }
  }
  return result;
}
/** 复用已存在的决策，局部补全失败题；未修复的问题仍标记 failed 供界面恢复。 */
export async function finalizeDecisionQuestions<T extends DecisionQuestion>(
  raw: T[],
  context: DecisionContext,
  mode: 'real' | 'example',
  signal: AbortSignal,
): Promise<(T & DecisionQuestion)[]> {
  const normalized = (normalizeDecisionOutput({ questions: raw }) as { questions: T[] }).questions;
  const fresh = normalized
    .filter(
      (q) =>
        !context.answers.some(
          (a) => sameDecisionTopic(a, q) && (decisionSettled(a) || a.status === 'open'),
        ),
    )
    .map((q) => validateQuestion(q, context) as T);
  const failed = fresh.filter((q) => !inspectDecision(q).ready).slice(0, 3);
  const targets = failed.map((q) => ({ id: stableDecisionId(q.title), question: q }));
  const repairs = targets.length
    ? await repairQuestionBatch(targets, context, mode, signal)
    : new Map<string, DecisionRepairResult>();
  return fresh.flatMap((q) => {
    if (inspectDecision(q).ready) return [q];
    const fixed = repairs.get(stableDecisionId(q.title));
    if (fixed?.questions.length) return fixed.questions.map((next) => ({ ...q, ...next }) as T);
    return [
      {
        ...q,
        decision: {
          ...q.decision!,
          generation: 'failed',
          issues: fixed?.issues ?? ['该问题的可选方案尚未生成完成。'],
        },
      } as T,
    ];
  });
}
