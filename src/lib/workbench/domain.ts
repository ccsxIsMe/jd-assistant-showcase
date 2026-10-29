import {
  changeFields,
  fields,
  newItem,
  now,
  uid,
  workspaceSchema,
  type Change,
  type ItemFields,
  type Reference,
  type Source,
  type Suggestion,
  type WorkItem,
  type Workspace,
} from './model';
import { decisionResponseSchema, type DecisionResponse } from '../decisions/schema';
import {
  decisionFingerprint,
  initializeDecision,
  replaceDecisionQuestion,
  stampDecisionResponse,
  type DecisionQuestion,
} from '../decisions/quality';
import { workbenchDecisionContext, contextFingerprint } from '../decisions/context';
import { resolveDecision, currentDecisions } from '../decisions/records';
export class WorkbenchError extends Error {}
export function log(w: Workspace, text: string) {
  w.activity.unshift({ id: uid(), text, at: now() });
  w.activity = w.activity.slice(0, 500);
}
export function touch(w: Workspace) {
  w.revision++;
  w.updatedAt = now();
  return w;
}
export function validateReference(sources: Source[], ref: Reference): Reference {
  const source = sources.find((s) => s.id === ref.sourceId);
  const version = source?.versions.find((v) => v.revision === ref.sourceRevision);
  const start = version?.text.indexOf(ref.excerpt) ?? -1;
  return { ...ref, start: start >= 0 ? start : null, verified: start >= 0 };
}
export function referenceStale(w: Workspace, ref: Reference) {
  const s = w.sources.find((s) => s.id === ref.sourceId);
  return (
    !s ||
    s.removed ||
    s.versions.at(-1)?.revision !== ref.sourceRevision ||
    !validateReference(w.sources, ref).verified
  );
}
export function related(w: Workspace, id: string) {
  const item = w.items.find((i) => i.id === id);
  if (!item) return [];
  return w.items.filter(
    (i) =>
      i.id !== id &&
      (i.taskIds.includes(id) ||
        i.requirementIds.includes(id) ||
        item.taskIds.includes(i.id) ||
        item.requirementIds.includes(i.id)),
  );
}
export function propagate(w: Workspace, changed: Set<string>) {
  const dependent = w.items.filter(
    (i) =>
      !changed.has(i.id) &&
      (i.taskIds.some((id) => changed.has(id)) || i.requirementIds.some((id) => changed.has(id))),
  );
  for (const i of dependent) {
    if (i.status !== 'excluded') {
      i.status = 'review';
      i.revision++;
      i.lastChange = now();
    }
  }
  return dependent.map((i) => i.id);
}
export function jdContextSignature(w: Workspace) {
  return JSON.stringify({
    items: w.items.filter((i) => i.kind !== 'block').map((i) => [i.id, i.revision]),
    questions: currentDecisions(w.questions).map((q) => [q.id, q.status, q.answer]),
    sources: w.sources.map((s) => [s.id, s.versions.at(-1)?.revision, s.removed]),
  });
}
export function contextKey(w: Workspace, targetId: string, intent: string) {
  const target = w.items.find((i) => i.id === targetId);
  return JSON.stringify({
    id: targetId,
    intent: intent.trim(),
    r: target?.revision,
    links: related(w, targetId).map((i) => [i.id, i.revision]),
    sources: w.sources.map((s) => [s.id, s.versions.at(-1)?.revision, s.removed]),
    jdContext: target?.kind === 'block' ? jdContextSignature(w) : undefined,
  });
}
export function suggestionStale(w: Workspace, s: Suggestion) {
  return (
    s.workspaceId !== w.id ||
    (!!s.contextSignature && s.contextSignature !== jdContextSignature(w)) ||
    s.changes.some((c) => {
      const i = w.items.find((i) => i.id === c.targetId);
      return (
        !i ||
        i.kind !== c.targetKind ||
        i.revision !== c.targetRevision ||
        JSON.stringify(fields(i)) !== JSON.stringify(c.before)
      );
    }) ||
    s.preconditions.some(
      (p) => w.items.find((i) => i.id === p.targetId)?.revision !== p.revision,
    ) ||
    s.changes.some((c) => c.refs.some((r) => referenceStale(w, r)))
  );
}
export function refreshSuggestions(w: Workspace) {
  for (const s of w.suggestions) {
    if (s.status === 'pending' && suggestionStale(w, s)) s.status = 'stale';
  }
}
export function editItem(
  w: Workspace,
  id: string,
  patch: Partial<ItemFields & Pick<WorkItem, 'taskIds' | 'requirementIds' | 'refs'>>,
  confirm = false,
) {
  const n = structuredClone(w);
  const i = n.items.find((i) => i.id === id);
  if (!i) throw new WorkbenchError('条目不存在');
  const before = structuredClone(i);
  Object.assign(i, patch);
  i.revision++;
  i.lastChange = now();
  i.status = confirm ? 'confirmed' : i.status === 'confirmed' ? 'review' : i.status;
  const ids = new Set([id]);
  const depsBefore = n.items
    .filter((x) => x.taskIds.includes(id) || x.requirementIds.includes(id))
    .map((x) => structuredClone(x));
  propagate(n, ids);
  n.operations.unshift({
    id: uid(),
    label: `人工修改${i.title}`,
    createdAt: now(),
    before: [before, ...depsBefore],
    after: n.items
      .filter((x) => x.id === id || depsBefore.some((d) => d.id === x.id))
      .map((x) => structuredClone(x)),
    suggestionId: null,
    undone: false,
  });
  refreshSuggestions(n);
  log(n, `${confirm ? '修改并确认' : '修改'}「${i.title}」`);
  return touch(n);
}
export function setItemState(w: Workspace, id: string, status: WorkItem['status']) {
  const n = structuredClone(w);
  const i = n.items.find((i) => i.id === id);
  if (!i) throw new WorkbenchError('条目不存在');
  const old = i.status;
  i.status = status;
  i.revision++;
  i.lastChange = now();
  if (status === 'excluded' || old === 'excluded') propagate(n, new Set([id]));
  refreshSuggestions(n);
  log(
    n,
    `将「${i.title}」设为${status === 'confirmed' ? '已确认' : status === 'excluded' ? '已排除' : '待确认'}`,
  );
  return touch(n);
}
export function toggleLock(w: Workspace, id: string) {
  const n = structuredClone(w);
  const i = n.items.find((i) => i.id === id);
  if (!i) throw new WorkbenchError('条目不存在');
  i.locked = !i.locked;
  i.revision++;
  refreshSuggestions(n);
  log(n, `${i.locked ? '锁定' : '解锁'}「${i.title}」`);
  return touch(n);
}
export function reviseSource(w: Workspace, id: string, text: string, remove = false) {
  const n = structuredClone(w);
  const s = n.sources.find((s) => s.id === id);
  if (!s) throw new WorkbenchError('资料不存在');
  if (!remove) {
    s.versions.push({
      ...s.versions.at(-1)!,
      revision: s.versions.at(-1)!.revision + 1,
      text,
      createdAt: now(),
    });
  }
  s.removed = remove;
  const affected = new Set<string>();
  for (const i of n.items) {
    if (i.refs.some((r) => r.sourceId === id)) {
      i.status = i.status === 'excluded' ? 'excluded' : 'review';
      i.revision++;
      affected.add(i.id);
    }
  }
  propagate(n, affected);
  n.questions.push({
    id: uid(),
    title: '资料依据已变化，需要复核',
    detail: `「${s.title}」${remove ? '已移除' : '新增修订版本'}；历史引用保留，请核实依赖条目。`,
    kind: 'dependency',
    important: true,
    targetIds: [...affected],
    refs: [],
    status: 'open',
    answer: '',
    reason: '',
    createdAt: now(),
  });
  refreshSuggestions(n);
  log(n, `${remove ? '移除' : '修订'}资料「${s.title}」，保留历史原文`);
  return touch(n);
}
export function addSuggestions(w: Workspace, suggestions: Suggestion[]) {
  const n = structuredClone(w);
  for (const s of suggestions) {
    if (s.workspaceId !== w.id) throw new WorkbenchError('建议岗位不匹配');
    if (
      n.suggestions.some(
        (x) =>
          x.contextKey === s.contextKey &&
          x.changes[0]?.targetId === s.changes[0]?.targetId &&
          x.status !== 'stale',
      )
    )
      continue;
    const normalized = {
      ...s,
      changes: s.changes.map((c) => ({
        ...c,
        refs: c.refs.map((r) => validateReference(w.sources, r)),
      })),
    };
    if (normalized.changes.some((c) => w.items.find((i) => i.id === c.targetId)?.locked)) {
      normalized.status = 'failed';
      normalized.error = '目标已锁定，无法修改。';
    } else if (suggestionStale(w, normalized)) normalized.status = 'stale';
    n.suggestions.unshift(normalized);
  }
  log(n, '收到修改建议，等待人工审阅，尚未修改正文');
  return touch(n);
}
/** 整组预检后在副本中应用；锁定或过期则抛错，不会向调用方返回半份修改。 */
export function applySuggestion(
  w: Workspace,
  suggestionId: string,
  edited?: Record<string, ItemFields>,
) {
  const n = structuredClone(w);
  const s = n.suggestions.find((s) => s.suggestionId === suggestionId);
  if (!s || s.status !== 'pending') throw new WorkbenchError('建议已处理或已过期，不能重复应用。');
  if (suggestionStale(n, s)) throw new WorkbenchError('目标或依据已变化，建议已过期，请重新生成。');
  for (const c of s.changes) {
    const i = n.items.find((i) => i.id === c.targetId);
    if (!i || i.locked) throw new WorkbenchError('目标已锁定，不能应用AI修改。');
    if (c.relatedIds.some((id) => !n.items.some((i) => i.id === id)))
      throw new WorkbenchError('关联条目缺失，整组修改未应用。');
  }
  const ids = new Set(s.changes.map((c) => c.targetId));
  const dependent = n.items.filter(
    (i) =>
      !ids.has(i.id) &&
      (i.taskIds.some((id) => ids.has(id)) || i.requirementIds.some((id) => ids.has(id))),
  );
  const allIds = new Set([...ids, ...dependent.map((i) => i.id)]);
  // 历史同时记录直接目标与需复核的依赖，撤销范围不包含无关岗位条目。
  const before = n.items.filter((i) => allIds.has(i.id)).map((i) => structuredClone(i));
  for (const c of s.changes) {
    const i = n.items.find((i) => i.id === c.targetId)!;
    Object.assign(i, changeFields.parse(edited?.[i.id] ?? c.after));
    i.status =
      c.operation === 'exclude' ? 'excluded' : i.status === 'confirmed' ? 'review' : 'pending';
    i.revision++;
    i.lastChange = now();
  }
  propagate(n, ids);
  s.status = 'applied';
  const after = n.items.filter((i) => allIds.has(i.id)).map((i) => structuredClone(i));
  n.operations.unshift({
    id: uid(),
    label: s.groupReason || s.intent,
    createdAt: now(),
    before,
    after,
    suggestionId,
    undone: false,
  });
  refreshSuggestions(n);
  log(n, `应用${s.changes.length > 1 ? '关联建议组' : '一条建议'}；未确认岗位条件`);
  return touch(n);
}
export function rejectSuggestion(w: Workspace, id: string) {
  const n = structuredClone(w);
  const s = n.suggestions.find((s) => s.suggestionId === id);
  if (!s || s.status !== 'pending') throw new WorkbenchError('该建议无法再处理');
  s.status = 'rejected';
  log(n, '拒绝建议，保留审阅记录');
  return touch(n);
}
/** 撤销前比较受影响对象的当前值与操作后值，避免覆盖后续人工编辑。 */
export function undoOperation(w: Workspace, id: string) {
  const n = structuredClone(w);
  const op = n.operations.find((o) => o.id === id);
  if (!op || op.undone) throw new WorkbenchError('该操作已撤销或不存在');
  for (const after of op.questionsAfter ?? [])
    if (JSON.stringify(n.questions.find((q) => q.id === after.id)) !== JSON.stringify(after))
      throw new WorkbenchError('问题已有后续编辑，不能撤销覆盖；其他内容保留。');
  for (const after of op.after) {
    const current = n.items.find((i) => i.id === after.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(after))
      throw new WorkbenchError(
        `「${after.title}」在此后已修改或锁定。存在撤销冲突，请查看历史对比后手动处理；没有回滚任何内容。`,
      );
  }
  for (const before of op.before) {
    const i = n.items.findIndex((i) => i.id === before.id);
    n.items[i] = {
      ...structuredClone(before),
      revision: n.items[i].revision + 1,
      lastChange: now(),
    };
  }
  op.undone = true;
  const beforeQuestions = new Set(op.questionsBefore?.map((q) => q.id) ?? []);
  n.questions = n.questions.filter(
    (q) => !op.questionsAfter?.some((after) => after.id === q.id && !beforeQuestions.has(q.id)),
  );
  for (const before of op.questionsBefore ?? []) {
    const index = n.questions.findIndex((q) => q.id === before.id);
    if (index >= 0) n.questions[index] = structuredClone(before);
  }
  refreshSuggestions(n);
  log(n, `撤销「${op.label}」，保留无关修改`);
  return touch(n);
}
export function respondToWorkbenchQuestion(w: Workspace, id: string, raw: DecisionResponse | null) {
  const n = structuredClone(w),
    q = resolveDecision(n.questions, id);
  if (!q) throw new WorkbenchError('问题不存在。');
  if (raw === null && !q.answer && !q.response) return w;
  const response =
    raw === null ? null : stampDecisionResponse(q, decisionResponseSchema.parse(raw));
  if (JSON.stringify(q.response) === JSON.stringify(response) && !q.decision?.answerNeedsReview)
    return w;
  if (response?.kind === 'custom' && !response.text.trim())
    throw new WorkbenchError('请填写自己的回答。');
  if (
    response?.kind === 'choice' &&
    (!response.choiceIds.length ||
      response.choiceIds.some((id) => !q.choices?.some((c) => c.id === id)))
  )
    throw new WorkbenchError('问题选项已变化，请重新核对。');
  const before = structuredClone(q),
    beforeItems = structuredClone(n.items);
  q.answer = !response
    ? ''
    : response.kind === 'choice'
      ? q
          .choices!.filter((c) => response.choiceIds.includes(c.id))
          .map((c) => c.label)
          .join('；')
      : response.kind === 'custom'
        ? response.text
        : response.kind === 'uncertain'
          ? '用户尚不确定，保留未知，不采纳默认推荐。'
          : response.kind === 'skipped'
            ? '用户暂时跳过，仍待确认。'
            : `用户表示现有选项均不适用。${response.text ? `补充偏好：${response.text}` : ''}`;
  if (response) q.response = response;
  else delete q.response;
  q.decision = {
    ...(q.decision ?? initializeDecision(q).decision!),
    answerNeedsReview: false,
    updatedAt: now(),
  };
  const recommended = q.choices?.find((c) => c.id === q.recommendation?.choiceId);
  if (response?.kind === 'uncertain' && recommended && q.recommendation)
    q.decision.provisional = { label: recommended.label, reason: q.recommendation.reason };
  else delete q.decision.provisional;
  q.status =
    !response || response.kind === 'uncertain' || response.kind === 'none'
      ? 'open'
      : response.kind === 'skipped'
        ? 'deferred'
        : 'resolved';
  for (const item of n.items)
    if (q.targetIds.includes(item.id) && item.status === 'confirmed' && !item.locked) {
      item.status = 'review';
      item.revision++;
      item.lastChange = now();
    }
  propagate(n, new Set(q.targetIds));
  const changed = n.items.filter(
      (i) => JSON.stringify(i) !== JSON.stringify(beforeItems.find((old) => old.id === i.id)),
    ),
    changedIds = new Set(changed.map((i) => i.id));
  n.operations.unshift({
    id: uid(),
    label: '记录问题选择与相关复核',
    createdAt: now(),
    before: beforeItems.filter((i) => changedIds.has(i.id)),
    after: structuredClone(changed),
    questionsBefore: [before],
    questionsAfter: [structuredClone(q)],
    suggestionId: null,
    undone: false,
  });
  log(n, '记录用户选择；条目仍需单独确认，可撤销本次决定');
  return touch(n);
}
export function setWorkbenchQuestionStatus(w: Workspace, id: string, status: 'open' | 'ignored') {
  const n = structuredClone(w),
    q = resolveDecision(n.questions, id);
  if (!q) throw new WorkbenchError('问题不存在。');
  if (status === 'ignored' && !q.answer.trim())
    throw new WorkbenchError('请先在同一回答入口记录排除理由。');
  if (q.status === status) return w;
  const before = structuredClone(q);
  q.status = status;
  if (status === 'ignored') q.reason = q.answer;
  q.decision = { ...(q.decision ?? initializeDecision(q).decision!), updatedAt: now() };
  n.operations.unshift({
    id: uid(),
    label: '调整问题处理状态',
    createdAt: now(),
    before: [],
    after: [],
    questionsBefore: [before],
    questionsAfter: [structuredClone(q)],
    suggestionId: null,
    undone: false,
  });
  log(n, '调整问题处理状态，保留当前回答与历史');
  return touch(n);
}
export function applyWorkbenchDecisionRepair(
  w: Workspace,
  id: string,
  expected: string,
  expectedContext: string,
  replacements: DecisionQuestion[],
) {
  const q = w.questions.find((q) => q.id === id);
  if (
    !q ||
    decisionFingerprint(q) !== expected ||
    contextFingerprint(workbenchDecisionContext(w, q)) !== expectedContext
  )
    throw new WorkbenchError('问题、资料或回答已有变化，迟到补全未应用。');
  const n = structuredClone(w),
    index = n.questions.findIndex((q) => q.id === id),
    after = replaceDecisionQuestion(n.questions[index], replacements);
  n.questions.splice(index, 1, ...after);
  n.operations.unshift({
    id: uid(),
    label: '局部补全选项并保留旧回答版本',
    createdAt: now(),
    before: [],
    after: [],
    questionsBefore: [structuredClone(q)],
    questionsAfter: structuredClone(after),
    suggestionId: null,
    undone: false,
  });
  log(n, '局部补全问题选项；旧答案待复核，可撤销');
  return touch(n);
}
export function splitTask(w: Workspace, id: string) {
  const n = structuredClone(w);
  const task = n.items.find((i) => i.id === id && i.kind === 'task');
  if (!task || task.locked) throw new WorkbenchError('任务已锁定或不存在');
  const copies = [1, 2].map((number) => ({
    ...structuredClone(task),
    id: uid(),
    revision: 1,
    title: task.title + ` · 拆分${number}`,
    status: 'pending' as const,
    origin: 'user' as const,
  }));
  task.status = 'excluded';
  task.revision++;
  n.items.splice(n.items.indexOf(task) + 1, 0, ...copies);
  for (const dependent of n.items) {
    if (dependent.taskIds.includes(id)) {
      dependent.taskIds = [...new Set([...dependent.taskIds, ...copies.map((i) => i.id)])];
    }
  }
  propagate(n, new Set([id]));
  refreshSuggestions(n);
  log(n, `拆分「${task.title}」为两项待编辑任务；保留原任务、旧关联和依据，请分别明确边界`);
  return touch(n);
}
export function mergeTasks(w: Workspace, ids: string[]) {
  const n = structuredClone(w);
  const items = n.items.filter((i) => ids.includes(i.id) && i.kind === 'task');
  if (items.length < 2 || items.some((i) => i.locked))
    throw new WorkbenchError('请选择至少两项未锁定任务');
  const merged = newItem(
    'task',
    items
      .map((i) => i.title)
      .join(' / ')
      .slice(0, 300),
    items.map((i) => i.text).join('\n\n'),
  );
  merged.refs = items.flatMap((i) => i.refs);
  merged.scope = items
    .map((i) => i.scope)
    .filter(Boolean)
    .join('；');
  n.items.push(merged);
  for (const i of items) {
    i.status = 'excluded';
    i.revision++;
  }
  for (const i of n.items) {
    if (i.taskIds.some((id) => ids.includes(id))) {
      i.taskIds = [...new Set([...i.taskIds, merged.id])];
      i.status = 'review';
      i.revision++;
    }
  }
  refreshSuggestions(n);
  log(n, '合并任务；原任务、依据与旧关联保留，新合并项待确认');
  return touch(n);
}
export function reorderTask(w: Workspace, id: string, direction: number | { beforeId: string }) {
  const n = structuredClone(w);
  const tasks = n.items.filter((i) => i.kind === 'task');
  const from = tasks.findIndex((i) => i.id === id);
  let to =
    typeof direction === 'number'
      ? from + direction
      : tasks.findIndex((i) => i.id === direction.beforeId);
  if (from < 0 || to < 0 || to >= tasks.length) return w;
  const [item] = tasks.splice(from, 1);
  if (typeof direction !== 'number' && from < to) to--;
  tasks.splice(to, 0, item);
  n.items = [...tasks, ...n.items.filter((i) => i.kind !== 'task')];
  log(n, '调整任务顺序');
  return touch(n);
}
export function unresolved(w: Workspace) {
  return currentDecisions(w.questions).filter(
    (q) =>
      q.important &&
      (q.decision?.answerNeedsReview || (q.status !== 'resolved' && q.status !== 'ignored')),
  );
}
export type ConfirmationCheck = {
  id: string;
  kind: 'category' | 'question' | 'item' | 'reference' | 'empty-jd';
  itemId?: string;
  questionId?: string;
  title: string;
  message: string;
  instruction: string;
  actionLabel: string;
};
export function confirmationChecks(w: Workspace): ConfirmationCheck[] {
  return [
    ...w.items
      .filter(
        (i) => i.kind === 'requirement' && i.status !== 'excluded' && i.category === 'unknown',
      )
      .map((i): ConfirmationCheck => ({
        id: `category:${i.id}`,
        kind: 'category',
        itemId: i.id,
        title: i.title,
        message: `${i.title}的条件分类仍未知`,
        instruction: '在编辑窗口核对必要、加分、可培养或不写入JD；暂时不确定可保留未知并保存草稿。',
        actionLabel: '核对条件分类',
      })),
    ...unresolved(w).map((q): ConfirmationCheck => ({
      id: `question:${q.id}`,
      kind: 'question',
      questionId: q.id,
      title: q.title,
      message: q.title,
      instruction:
        q.status === 'deferred'
          ? '这项重要问题已暂缓。可继续保留未知、保存草稿；正式确认前需记录实际决定或排除理由。'
          : '在共创助手的同一回答入口记录决定；已有研究回答可确认沿用，无需重新填写。',
      actionLabel: '打开此问题',
    })),
    ...w.items
      .filter((i) => i.status !== 'confirmed' && i.status !== 'excluded' && i.category !== 'omit')
      .map((i): ConfirmationCheck => ({
        id: `item:${i.id}`,
        kind: 'item',
        itemId: i.id,
        title: i.title,
        message: `${i.title}尚未确认`,
        instruction:
          i.kind === 'block'
            ? '在JD编辑中核对这段正文；有误可直接修改，正确后点击该段下方的“确认段落”。'
            : '核对这项内容与职责边界，正确后点击条目下方的“确认”；不会由系统代为确认。',
        actionLabel: i.kind === 'block' ? '去核对这段JD' : '去核对这项内容',
      })),
    ...w.items
      .filter((i) => i.status !== 'excluded' && i.refs.some((r) => referenceStale(w, r)))
      .map((i): ConfirmationCheck => ({
        id: `reference:${i.id}`,
        kind: 'reference',
        itemId: i.id,
        title: i.title,
        message: `${i.title}的依据需复核`,
        instruction:
          '在现有编辑窗口对照资料当前版本更新引用，移除失效引用。只确认正文不能消除失效依据。',
        actionLabel: '核对这项依据',
      })),
    ...(!w.items.some((i) => i.kind === 'block' && i.status !== 'excluded')
      ? [
          {
            id: 'empty-jd',
            kind: 'empty-jd' as const,
            title: 'JD正文',
            message: 'JD正文为空',
            instruction: '到JD编辑主动生成草稿，或手动补充正文；跳转本身不会调用AI。',
            actionLabel: '打开JD编辑',
          },
        ]
      : []),
  ];
}
export function confirmationIssues(w: Workspace) {
  return confirmationChecks(w).map((check) => check.message);
}
export function saveVersion(w: Workspace, kind: 'draft' | 'confirmed') {
  const n = structuredClone(w);
  if (kind === 'confirmed' && confirmationIssues(w).length)
    throw new WorkbenchError('仍有重要未决事项、未确认内容或失效依据，请处理后再保存确认版本。');
  n.versions.unshift({
    id: uid(),
    number: n.versions.length + 1,
    title: `${kind === 'confirmed' ? '确认' : '草稿'}版本 ${n.versions.length + 1}`,
    createdAt: now(),
    items: structuredClone(n.items),
    sources: structuredClone(n.sources),
    questions: structuredClone(n.questions),
    kind,
    mode: n.mode,
  });
  log(n, `保存${kind === 'confirmed' ? '确认' : '草稿'}版本`);
  return touch(n);
}
export function restoreVersion(w: Workspace, id: string) {
  const n = saveVersion(w, 'draft');
  const v = n.versions.find((v) => v.id === id);
  if (!v) throw new WorkbenchError('版本不存在');
  const oldSources = structuredClone(n.sources);
  n.items = structuredClone(v.items).map((i) => ({
    ...i,
    revision: (n.items.find((x) => x.id === i.id)?.revision ?? i.revision) + 1,
    status: i.status === 'excluded' ? 'excluded' : 'review',
    lastChange: now(),
  }));
  for (const source of v.sources) {
    if (!oldSources.some((s) => s.id === source.id)) oldSources.push(structuredClone(source));
  }
  n.sources = oldSources;
  n.questions = structuredClone(v.questions);
  refreshSuggestions(n);
  log(n, `从版本 ${v.number} 恢复到新草稿；当前资料与历史版本全部保留`);
  return touch(n);
}
export function jdBody(w: Workspace, withMode = true) {
  const blocks = w.items.filter((i) => i.kind === 'block' && i.status !== 'excluded');
  return (
    `${w.demo ? `> 示例项目｜虚构材料｜${w.mode === 'example' ? '预置分析结果' : '真实AI重分析'}\n\n` : ''}${withMode ? `> ${w.example ? '虚构示例 · ' : ''}${w.mode === 'example' ? '示例演示/预置响应，非真实AI分析' : '真实AI协作 · 请人工核实'}\n\n` : ''}> ${confirmationIssues(w).length ? '草稿 · 含待确认内容' : '岗位内容已确认'}\n\n# ${w.title}\n\n` +
    blocks
      .map((b) => `## ${b.title}${b.status !== 'confirmed' ? '（待确认）' : ''}\n\n${b.text}`)
      .join('\n\n')
  );
}
export function checkedWorkspace(data: unknown) {
  return workspaceSchema.parse(data);
}
export function makeChange(
  item: WorkItem,
  after: ItemFields,
  reason: string,
  operation: Change['operation'] = 'update',
): Change {
  return {
    targetId: item.id,
    targetKind: item.kind,
    targetRevision: item.revision,
    before: fields(item),
    after,
    operation,
    reason,
    refs: item.refs,
    relatedIds: [...item.taskIds, ...item.requirementIds],
  };
}
