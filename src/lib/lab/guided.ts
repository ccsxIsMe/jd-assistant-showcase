import type { Exploration, Evidence } from '../exploration/model';
import { evidenceValid } from '../exploration/domain';
import { digest } from './graph';
import { goalRelevance } from './evidence-selection';
import { decisionSettled } from '../decisions/quality';
import { currentDecisions } from '../decisions/records';
export const researchSteps = ['materials', 'evidence', 'requirements', 'roles', 'handoff'] as const;
export type ResearchStep = (typeof researchSteps)[number];
export const researchStepNames = {
  materials: '整理资料',
  evidence: '确认证据',
  requirements: '整理产品需求',
  roles: '比较岗位方案',
  handoff: '导出并继续共创',
};
export function sourceSetSignature(p: Exploration) {
  return digest([
    p.initialObjective,
    p.sources
      .filter((s) => !s.removed)
      .map((s) => [
        s.id,
        s.versions.at(-1)?.revision,
        s.status,
        s.purpose,
        s.borrow,
        s.avoid,
        s.referencePurpose,
      ]),
  ]);
}
export function questionPriority(p: Exploration, q: Exploration['questions'][number]) {
  const findings = p.findings.filter((f) => q.findingIds.includes(f.id) && f.status !== 'excluded');
  if (findings.some((f) => f.kind === 'conflict' || f.priority === 'high'))
    return {
      level: 'high' as const,
      label: '重点确认',
      reason: '关联核心范围或冲突结论，可能改变后续方案。',
    };
  if (
    findings.some((f) => ['feature', 'condition', 'risk'].includes(f.kind)) ||
    p.lab?.requirements.some(
      (r) => r.status !== 'excluded' && r.relatedFeatureIds.some((id) => q.findingIds.includes(id)),
    )
  )
    return {
      level: 'medium' as const,
      label: '影响方案',
      reason: '关联功能、约束或岗位要求，可先保留为方案假设。',
    };
  return {
    level: 'low' as const,
    label: '可稍后处理',
    reason: '当前未关联核心范围或岗位要求，不阻塞继续研究。',
  };
}
export function orderedQuestions(p: Exploration) {
  const order = { high: 0, medium: 1, low: 2 };
  return currentDecisions(p.questions)
    .filter((q) => q.status !== 'excluded' || q.decision?.answerNeedsReview)
    .map((q) => ({ ...q, priority: questionPriority(p, q) }))
    .sort(
      (a, b) =>
        Number(decisionSettled(a)) - Number(decisionSettled(b)) ||
        order[a.priority.level] - order[b.priority.level],
    );
}
export function evidenceReviewSignature(p: Exploration) {
  return digest([
    sourceSetSignature(p),
    p.evidence.map((e) => [
      e.evidenceId,
      e.sourceRevision,
      e.verificationStatus,
      e.location,
      e.excerpt,
    ]),
    p.lab?.edges
      .filter((e) => e.relationType === 'conflicts_with')
      .map((e) => [e.id, e.evidenceRefs, e.rationale]),
    orderedQuestions(p)
      .filter((q) => q.priority.level === 'high')
      .map((q) => [q.id, q.title, q.detail, q.evidenceIds]),
  ]);
}
export function groupedEvidence(p: Exploration) {
  const map = new Map<
    string,
    { id: string; excerpt: string; items: Evidence[]; importance: number }
  >();
  for (const e of p.evidence) {
    if (
      !e.sourceId ||
      !p.sources.some(
        (s) =>
          s.id === e.sourceId && !s.removed && s.versions.at(-1)?.revision === e.sourceRevision,
      )
    )
      continue;
    const key = e.excerpt.trim().replace(/\s+/g, ' ').toLowerCase() || e.evidenceId;
    const related = p.findings.filter(
      (f) => f.evidenceIds.includes(e.evidenceId) && f.status !== 'excluded',
    );
    const importance =
      goalRelevance(p, e) +
      (related.some((f) => f.priority === 'high' || f.kind === 'conflict')
        ? 3
        : related.some((f) => f.kind === 'feature')
          ? 2
          : e.evidenceType === 'user-description'
            ? 1
            : 0);
    const row = map.get(key);
    if (row) {
      row.items.push(e);
      row.importance = Math.max(row.importance, importance);
    } else map.set(key, { id: e.evidenceId, excerpt: e.excerpt, items: [e], importance });
  }
  return [...map.values()].sort((a, b) => b.importance - a.importance);
}
export function researchProgress(p: Exploration) {
  const lab = p.lab,
    validSources = p.sources.filter(
      (s) =>
        !s.removed &&
        s.purpose !== 'excluded' &&
        ['ready', 'partial'].includes(s.status) &&
        (s.versions.at(-1)?.text.trim() || s.versions.at(-1)?.assetId),
    );
  const evidence = p.evidence.filter((e) => evidenceValid(p, e));
  const features = p.findings.filter(
    (f) => f.kind === 'feature' && f.status !== 'excluded' && f.basis !== 'excluded',
  );
  const plans =
    lab?.solutions.filter(
      (s) => lab.activeSolutionIds.includes(s.id) && s.status === 'confirmed',
    ) ?? [];
  const requirements =
    lab?.requirements.filter(
      (r) => r.status === 'confirmed' && plans.some((s) => s.id === r.solutionId),
    ) ?? [];
  const eligible = new Set(requirements.map((r) => r.id));
  const selected = lab?.researchGuide.importRequirementIds.filter((id) => eligible.has(id)) ?? [];
  const sourceDone =
    validSources.length > 0 && lab?.researchGuide.sourceSignature === sourceSetSignature(p);
  const evidenceDone =
    (evidence.length > 0 || !!lab?.annotations.length) &&
    lab?.researchGuide.evidenceSignature === evidenceReviewSignature(p);
  const states = {
    materials: {
      done: sourceDone,
      count: validSources.length,
      note: sourceDone
        ? '资料集合已确认'
        : validSources.length
          ? '可确认当前资料集合'
          : '先添加一份资料或想法',
    },
    evidence: {
      done: evidenceDone,
      count: evidence.length,
      note: evidenceDone ? '关键证据已查看，未决项保留' : '查看核心证据，不必逐条确认全部',
    },
    requirements: {
      done: features.length > 0,
      count: features.length,
      note: features.length
        ? `${features.filter((f) => f.status === 'confirmed').length}项已确认，其余仍为候选`
        : '整理一组可比较的产品功能',
    },
    roles: {
      done: plans.length > 0 && selected.length > 0,
      count: plans.length,
      note:
        plans.length && selected.length
          ? `已选择${selected.length}项导入要求`
          : '选择方案并确认准备导入的要求',
    },
    handoff: {
      done: p.transfers?.some((t) => t.kind === 'workbench-import') ?? false,
      count: p.snapshots.length,
      note: p.transfers?.some((t) => t.kind === 'workbench-import')
        ? '已有实际导入记录'
        : '预览后保存快照并继续岗位共创',
    },
  };
  return {
    states,
    validSources,
    evidence,
    features,
    plans,
    requirements,
    selectedImportIds: selected,
    next: researchSteps.find((step) => !states[step].done) ?? 'handoff',
    questions: orderedQuestions(p),
  };
}
