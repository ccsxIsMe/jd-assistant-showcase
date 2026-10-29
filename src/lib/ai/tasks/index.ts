import { extractRequirements } from './extract-requirements';
import { inspectIssues } from './inspect-issues';
import { generateJdDraft } from './generate-jd-draft';
import { proposeLocalChanges } from './propose-local-changes';
import {
  commonSystemPrompt,
  envelope,
  material,
  taskNameForAction,
  type TaskDefinition,
} from './common';
import { localOutput } from './common';
import { fields } from '@/lib/workbench/model';
import { validateReference } from '@/lib/workbench/domain';
import { allowedTargetItems } from '@/lib/workbench/ai-scope';
import { localRef, type AIRequest, type AIResult } from '@/lib/workbench/ai-contract';
import { decisionQuestionPrompt } from './decision-options';
import { ModelError } from '../errors';
export { taskNameForAction } from './common';
export const taskRegistry = {
  extractRequirements,
  inspectIssues,
  generateJdDraft,
  proposeLocalChanges,
};
export function prepareTask(req: AIRequest) {
  const task = taskRegistry[taskNameForAction[req.action]];
  let input: unknown = material(req);
  if (req.action === 'draft') {
    if (req.context.items.some((i) => i.kind === 'block'))
      throw new Error('已有JD请使用局部修改审阅，不能覆盖现有草稿。');
    if (
      !req.context.items.some(
        (i) => i.status === 'confirmed' && i.kind !== 'block' && i.category !== 'omit',
      )
    )
      throw new Error('请先由人确认至少一项任务或要求，再生成JD草稿。');
    input = {
      ...material(req),
      items: req.context.items.filter((i) => i.status === 'confirmed' && i.category !== 'omit'),
      generationMode: 'initial',
    };
  }
  if (req.action === 'suggest') {
    const target = req.context.items.find((i) => i.id === req.targetId);
    if (!target || target.locked) throw new Error('请选择未锁定的工作对象');
    const scope = allowedTargetItems(req);
    input = {
      ...material(req),
      items: req.context.items.filter(
        (i) => i.status === 'confirmed' || scope.some((s) => s.id === i.id),
      ),
      target,
      intent: req.intent,
      allowedItems: scope.filter((i) => !i.locked),
      lockedIds: scope.filter((i) => i.locked).map((i) => i.id),
    };
  }
  return { task, input: task.inputSchema.parse(input) };
}
export function taskPrompt(task: TaskDefinition) {
  return `${commonSystemPrompt}\n${decisionQuestionPrompt}\n任务：${task.name}\n提示词版本：${task.promptVersion}\n${task.instruction}\n只输出本任务指定的顶层字段，不套用其他任务的结构。所有文字必须是合法JSON字符串，双引号、反斜杠和换行正确转义；数组字段保留数组类型。\n完整JSON结构样例（只示范结构，不是当前事实）：\n${JSON.stringify(task.exampleOutput, null, 2)}`;
}
export function normalizeTaskOutput(req: AIRequest, raw: unknown): AIResult {
  const { task } = prepareTask(req);
  const output = task.outputSchema.parse(raw);
  if (req.action === 'suggest') {
    const local = localOutput.parse(output);
    for (const group of local.groups)
      for (const c of group.changes) {
        const item = req.context.items.find((i) => i.id === c.targetId);
        if (
          !item ||
          !(Object.keys(fields(item)) as (keyof typeof c.before)[]).every(
            (key) => fields(item)[key] === c.before[key],
          )
        )
          throw new ModelError('TARGET_VERSION', '建议修改前内容与请求快照不一致', 422, [
            {
              code: 'TARGET_VERSION',
              path: 'groups.changes.before',
              message: 'before必须完整、逐字复制允许目标的当前字段，不能改写或省略。',
            },
          ]);
        if (
          c.refs.some(
            (r) =>
              !validateReference(
                req.context.sources,
                localRef(r.sourceId, r.sourceRevision, r.excerpt),
              ).verified,
          )
        )
          throw new ModelError('INVALID_REFERENCE', '局部建议引用不在对应原文中', 422, [
            {
              code: 'INVALID_REFERENCE',
              path: 'groups.changes.refs',
              message:
                '请使用实际sourceId、sourceRevision和逐字存在的excerpt；没有依据时保留未知，不编造引用。',
            },
          ]);
        const allowed = new Set(allowedTargetItems(req).map((i) => i.id));
        if (c.impactIds.some((id) => !allowed.has(id)))
          throw new ModelError('INVALID_SCOPE', '建议关联影响超出允许范围', 422, [
            {
              code: 'INVALID_SCOPE',
              path: 'groups.changes.impactIds',
              message: '关联影响只能引用allowedItems中的ID。',
            },
          ]);
      }
    return envelope({
      groups: local.groups.map((g) => ({
        reason: g.reason,
        changes: g.changes.map(({ before, impactIds, ...change }) => {
          void before;
          void impactIds;
          return change;
        }),
      })),
      notice: local.notice,
    });
  }
  const result = envelope(output as Partial<AIResult>);
  const citations = [
    ...result.tasks.flatMap((i) => i.refs),
    ...result.requirements.flatMap((i) => i.refs),
    ...result.blocks.flatMap((i) => i.refs),
    ...result.questions.flatMap((i) => i.refs),
    ...result.groups.flatMap((g) => g.changes.flatMap((c) => c.refs)),
  ];
  if (
    citations.some(
      (r) =>
        !validateReference(req.context.sources, localRef(r.sourceId, r.sourceRevision, r.excerpt))
          .verified,
    )
  )
    throw new Error('模型引用不在对应原文版本中，结果未采用');
  if (
    req.action === 'extract' &&
    [...result.tasks, ...result.requirements].some((i) => !i.refs.length)
  )
    throw new Error('候选任务或要求缺少资料依据');
  const answered = req.context.questions?.filter((q) => q.status !== 'open' || !!q.response) ?? [];
  const normalize = (v: string) => v.replace(/[\s\p{P}]/gu, '').toLowerCase();
  result.questions = result.questions.filter(
    (q) => !answered.some((a) => normalize(a.title) === normalize(q.title)),
  );
  if (req.action === 'draft') {
    if (!result.blocks.length)
      throw new ModelError('EMPTY_OUTPUT', '模型没有返回JD内容块，未生成草稿。', 422, [
        {
          code: 'EMPTY_OUTPUT',
          path: 'blocks',
          message: '至少返回一个只基于已确认内容的JD内容块。',
        },
      ]);
    for (const b of result.blocks) {
      if (
        [...b.taskIds, ...b.requirementIds].some(
          (id) =>
            !req.context.items.some(
              (i) => i.id === id && i.status === 'confirmed' && i.category !== 'omit',
            ),
        )
      )
        throw new Error('JD包含未确认条件，结果未采用');
    }
  }
  return result;
}
