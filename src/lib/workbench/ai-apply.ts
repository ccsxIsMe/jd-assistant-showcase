import {
  contextKey,
  jdContextSignature,
  makeChange,
  validateReference,
  addSuggestions,
  log,
  touch,
} from './domain';
import { aiOutputSchema, localRef, type AIRequest, type AIResult } from './ai-contract';
import { newItem, now, uid, type Suggestion, type Workspace } from './model';
import { allowedTargetItems } from './ai-scope';
import { reconcileDecisions } from '../decisions/records';
export function validateAIResult(req: AIRequest, raw: unknown): AIResult {
  const data = aiOutputSchema.parse(raw);
  const { context } = req;
  if (req.action !== 'extract' && (data.tasks.length || data.requirements.length))
    throw new Error('模型越出当前整理范围。');
  if (req.action !== 'draft' && data.blocks.length) throw new Error('模型越出JD生成范围。');
  if (req.action !== 'suggest' && data.groups.length) throw new Error('模型越出局部修改范围。');
  const allowed = new Set(allowedTargetItems(req).map((i) => i.id));
  const touched = new Set<string>();
  for (const group of data.groups)
    for (const c of group.changes) {
      const i = context.items.find((i) => i.id === c.targetId);
      if (!i || !allowed.has(i.id)) throw new Error('模型尝试修改未选中或非直接关联内容。');
      if (i.locked) throw new Error('模型尝试修改锁定项，结果已拒绝。');
      if (touched.has(i.id)) throw new Error('多个建议重复修改同一对象，请重试。');
      touched.add(i.id);
    }
  for (const b of data.blocks) {
    if (
      b.taskIds.some((id) => !context.items.some((i) => i.id === id && i.kind === 'task')) ||
      b.requirementIds.some(
        (id) => !context.items.some((i) => i.id === id && i.kind === 'requirement'),
      )
    )
      throw new Error('JD包含不存在的关联对象。');
  }
  return data;
}
function refs(w: Workspace, citations: AIResult['tasks'][number]['refs']) {
  return citations.map((r) =>
    validateReference(w.sources, localRef(r.sourceId, r.sourceRevision, r.excerpt)),
  );
}
export function materializeSuggestions(
  base: Workspace,
  req: AIRequest,
  data: AIResult,
): Suggestion[] {
  return data.groups.map((group) => ({
    suggestionId: uid(),
    workspaceId: base.id,
    baseRevision: base.revision,
    contextKey: contextKey(base, req.targetId ?? '', req.intent),
    contextSignature:
      base.items.find((i) => i.id === req.targetId)?.kind === 'block'
        ? jdContextSignature(base)
        : undefined,
    intent: req.intent,
    createdAt: now(),
    changes: group.changes.map((c) => {
      const item = base.items.find((i) => i.id === c.targetId)!;
      return { ...makeChange(item, c.after, c.reason, c.operation), refs: refs(base, c.refs) };
    }),
    preconditions: req.targetId
      ? [
          {
            targetId: req.targetId,
            revision: base.items.find((i) => i.id === req.targetId)!.revision,
          },
        ]
      : [],
    status: 'pending',
    groupReason: group.reason,
    error: '',
  }));
}
export function ingestAI(
  current: Workspace,
  base: Workspace,
  req: AIRequest,
  result: unknown,
): Workspace {
  const data = validateAIResult(req, result);
  if (current.id !== base.id) throw new Error('岗位已切换，未应用结果。');
  if (req.action === 'suggest')
    return addSuggestions(current, materializeSuggestions(base, req, data));
  const n = structuredClone(current);
  if (req.action === 'extract') {
    if (
      current.sources.some(
        (s) =>
          base.sources.find((x) => x.id === s.id)?.versions.at(-1)?.revision !==
          s.versions.at(-1)?.revision,
      ) ||
      current.sources.length !== base.sources.length
    )
      throw new Error('整理期间资料有变化，请重新整理；结果未写入。');
    const map = new Map<string, string>();
    for (const c of data.tasks) {
      if (n.items.some((i) => i.kind === 'task' && i.title === c.title)) continue;
      const i = newItem('task', c.title, c.text);
      i.scope = c.scope;
      i.origin = 'ai';
      i.refs = refs(n, c.refs);
      map.set(c.key, i.id);
      n.items.push(i);
    }
    for (const c of data.requirements) {
      if (n.items.some((i) => i.kind === 'requirement' && i.title === c.title)) continue;
      const i = newItem('requirement', c.title, c.text);
      i.scope = c.scope;
      i.category = c.category;
      i.origin = 'ai';
      i.refs = refs(n, c.refs);
      i.taskIds = c.taskKeys.map((key) => map.get(key)).filter((id): id is string => !!id);
      n.items.push(i);
    }
  }
  if (req.action === 'draft') {
    if (
      current.items.some((i) => i.kind === 'block') ||
      current.items.some((i) => base.items.find((x) => x.id === i.id)?.revision !== i.revision) ||
      current.items.length !== base.items.length
    )
      throw new Error('生成期间已有内容变化或已有JD；草稿未覆盖，请重试或局部更新。');
    for (const b of data.blocks) {
      const i = newItem('block', b.title, b.text);
      i.origin = 'ai';
      i.taskIds = b.taskIds;
      i.requirementIds = b.requirementIds;
      i.refs = refs(n, b.refs);
      n.items.push(i);
    }
    n.ui.view = 'jd';
  }
  for (const q of data.questions) {
    if (
      n.questions.some(
        (x) =>
          x.title === q.title &&
          JSON.stringify([...x.targetIds].sort()) === JSON.stringify([...q.targetIds].sort()),
      )
    )
      continue;
    const targetIds = q.targetIds.filter((id) => n.items.some((i) => i.id === id));
    if (!targetIds.length)
      targetIds.push(
        ...n.items
          .filter((i) => i.refs.some((r) => q.refs.some((ref) => ref.sourceId === r.sourceId)))
          .map((i) => i.id),
      );
    n.questions.push({
      id: uid(),
      ...q,
      targetIds,
      kind: 'potential',
      status: 'open',
      answer: '',
      reason: '',
      createdAt: now(),
      refs: refs(n, q.refs),
    });
  }
  log(
    n,
    req.action === 'extract'
      ? '从资料整理候选任务与要求；全部待确认'
      : req.action === 'draft'
        ? '生成待确认JD草稿；尚未作为正式版本'
        : '整理待确认问题',
  );
  n.questions = reconcileDecisions(n.questions, n.id);
  return touch(n);
}
