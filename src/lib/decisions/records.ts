import { initializeDecision, normalizeText, type DecisionQuestion } from './quality';
type RecordQuestion = DecisionQuestion & {
  id: string;
  findingIds?: string[];
  evidenceIds?: string[];
  targetIds?: string[];
  refs?: { sourceId: string; sourceRevision?: number }[];
};
// 标题相似不能决定合并：所属项目、关联对象、阶段、视角与决策维度都须一致。
// 范围无法证明一致时保持独立，避免把不同岗位或参考产品的问题误合并。
export function decisionIdentity(q: RecordQuestion, ownerId: string) {
  const scope = q.decisionSpec?.scope;
  const objects = [
    ...new Set(q.findingIds?.length ? q.findingIds : q.targetIds?.length ? q.targetIds : []),
  ].sort();
  if (!objects.length) return null;
  if (scope?.objectIds.some((id) => !objects.includes(id))) return null;
  const phase =
    scope?.phase ??
    (/后续|下一阶段|第二阶段/.test(q.title)
      ? 'next'
      : /首版|第一阶段|MVP/i.test(q.title)
        ? 'mvp'
        : 'unspecified');
  const perspective =
    scope?.perspective ??
    (/参考产品.*(具备|是否有|是否支持)|来源.*(具备|是否有)/.test(q.title)
      ? 'reference_product'
      : q.targetIds
        ? 'role'
        : 'our_product');
  const binaryCollaboration =
    /(多人|多个用户|实时).*(协作|编辑|修改)|协作.*实时/.test(q.title) &&
    /是否|要不要|需不需要|(?:需要|支持).*吗[？?]?$/.test(q.title) &&
    !/[0-9]|人数|数量|多少|上限|延迟|频率|方式|如何|怎么|谁/.test(q.title);
  const dimension = scope?.dimension ?? (binaryCollaboration ? 'collaborative-editing' : undefined);
  if (!dimension) return null;
  return JSON.stringify([ownerId, objects, phase, perspective, normalizeText(dimension)]);
}
/** 旧问题 ID 仍可用于图谱引用，但实时读写应解析到唯一 canonicalId；拒绝别名环。 */
export function resolveDecision<T extends RecordQuestion>(
  questions: T[],
  id: string,
): T | undefined {
  let q = questions.find((q) => q.id === id);
  const seen = new Set<string>();
  while (q?.decision?.canonicalId && q.decision.canonicalId !== q.id) {
    if (seen.has(q.id)) return undefined;
    seen.add(q.id);
    q = questions.find((next) => next.id === q!.decision!.canonicalId);
  }
  return q;
}
export function currentDecisions<T extends RecordQuestion>(questions: T[]): T[] {
  return questions.filter((q) => !q.decision?.canonicalId || q.decision.canonicalId === q.id);
}
/** 兼容旧重复问题：保留原答案历史，冲突答案标记复核，不擅自挑选新答案。 */
export function reconcileDecisions<T extends RecordQuestion>(questions: T[], ownerId: string): T[] {
  const result = structuredClone(questions);
  const answered = (q: RecordQuestion) =>
    !!q.answer?.trim() &&
    q.status !== 'deferred' &&
    !['uncertain', 'skipped'].includes(q.response?.kind ?? '') &&
    (!!q.response || ['answered', 'resolved', 'excluded', 'ignored'].includes(q.status ?? ''));
  const byIdentity = new Map<string, T>();
  for (const q of result)
    if (q.decision?.canonicalId && !resolveDecision(result, q.id))
      throw new Error('决策别名引用不存在或存在循环；原数据保留，请检查导入内容。');
  for (const q of result) {
    if (q.decision?.canonicalId && q.decision.canonicalId !== q.id && resolveDecision(result, q.id))
      continue;
    const identity = decisionIdentity(q, ownerId);
    if (!identity) continue;
    q.decision = {
      ...(q.decision ?? {
        ...initializeDecision(q).decision!,
        version: q.response?.questionVersion ?? 1,
        optionsVersion: q.response?.optionsVersion ?? 1,
      }),
      identity,
    };
    const root = byIdentity.get(identity);
    if (!root) {
      byIdentity.set(identity, q);
      continue;
    }
    root.decision!.aliasIds = [
      ...new Set([...(root.decision!.aliasIds ?? []), q.id, ...(q.decision?.aliasIds ?? [])]),
    ];
    const histories = [
      ...(root.decision!.mergedAnswers ?? []),
      ...[root, q].map((v) => ({
        id: v.id,
        title: v.title,
        answer: v.answer ?? '',
        status: v.status ?? 'open',
        ...(v.response ? { response: v.response } : {}),
      })),
    ];
    root.decision!.mergedAnswers = histories.filter(
      (v, i, a) => a.findIndex((other) => JSON.stringify(other) === JSON.stringify(v)) === i,
    );
    if ((!root.answer?.trim() && q.answer?.trim()) || (!answered(root) && answered(q))) {
      root.answer = q.answer;
      root.status = q.status;
      root.response = q.response;
      root.choices = q.choices;
      root.recommendation = q.recommendation;
      root.decision!.version =
        q.decision?.version ?? q.response?.questionVersion ?? root.decision!.version;
      root.decision!.optionsVersion =
        q.decision?.optionsVersion ?? q.response?.optionsVersion ?? root.decision!.optionsVersion;
    }
    if (
      answered(root) &&
      answered(q) &&
      (root.answer ?? '').replace(/\s/g, '') !== (q.answer ?? '').replace(/\s/g, '')
    )
      root.decision!.answerNeedsReview = true;
    if (root.findingIds)
      root.findingIds = [...new Set([...root.findingIds, ...(q.findingIds ?? [])])];
    if (root.evidenceIds)
      root.evidenceIds = [...new Set([...root.evidenceIds, ...(q.evidenceIds ?? [])])];
    if (root.targetIds) root.targetIds = [...new Set([...root.targetIds, ...(q.targetIds ?? [])])];
    if (root.refs)
      root.refs = [...root.refs, ...(q.refs ?? [])].filter(
        (v, i, a) => a.findIndex((other) => JSON.stringify(other) === JSON.stringify(v)) === i,
      );
    // 别名记录只保留迁移原文；图谱 ID 与连线不用重建，回答统一写入主记录。
    q.decision = { ...q.decision!, canonicalId: root.id };
  }
  return result;
}
export function decisionAnswer(q: DecisionQuestion) {
  return (
    q.answer?.trim() ||
    (q.response?.kind === 'uncertain'
      ? '尚不确定'
      : q.response?.kind === 'skipped'
        ? '已暂缓'
        : q.decisionSpec?.knownAnswer?.text || '尚未决定')
  );
}
export function appendGeneratedDecision<T extends RecordQuestion>(
  questions: T[],
  candidate: T,
  ownerId: string,
): T[] {
  const key = decisionIdentity(candidate, ownerId),
    root = key
      ? currentDecisions(questions).find((q) => decisionIdentity(q, ownerId) === key)
      : undefined;
  if (!root) return [...questions, candidate];
  const copy = structuredClone(questions),
    target = copy.find((q) => q.id === root.id)!;
  if (target.evidenceIds)
    target.evidenceIds = [...new Set([...target.evidenceIds, ...(candidate.evidenceIds ?? [])])];
  if (target.refs)
    target.refs = [...target.refs, ...(candidate.refs ?? [])].filter(
      (v, i, a) => a.findIndex((other) => JSON.stringify(other) === JSON.stringify(v)) === i,
    );
  return copy;
}
