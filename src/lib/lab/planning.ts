import type { Exploration } from '../exploration/model';
import { evidenceValid } from '../exploration/domain';
import { digest } from './graph';
import { orderedQuestions } from './guided';
import type { LabStage } from './model';
import { aiStages } from './ai-contract';
export function planningSignature(p: Exploration, stage: LabStage) {
  const base = [
    p.initialObjective,
    p.overviewMode === 'manual' ? p.overview.goal : '',
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
    p.evidence
      .filter((e) => evidenceValid(p, e))
      .map((e) => [e.evidenceId, e.sourceRevision, e.excerpt, e.location]),
  ];
  return digest([
    ...base,
    ...(stage === 'derive_features'
      ? []
      : [
          p.findings.map((f) => [
            f.id,
            f.kind,
            f.title,
            f.description,
            f.behavior,
            f.outcome,
            f.basis,
            f.evidenceIds,
            f.status === 'excluded',
            f.locked,
          ]),
        ]),
    ...(stage === 'propose_roles'
      ? [
          p.questions
            .filter((q) => q.answer || q.response)
            .map((q) => [q.id, q.status, q.answer, q.response]),
        ]
      : []),
  ]);
}
export function readPlanningConstraints(p: Exploration) {
  const text =
    p.sources.find((s) => !s.removed && s.title === '规划约束（用户补充）')?.versions.at(-1)
      ?.text ?? '';
  const line = (prefix: string) =>
    text
      .split('\n')
      .find((v) => v.startsWith(prefix))
      ?.slice(prefix.length) ?? '';
  const prefix = '其他约束（用户填写）：',
    start = text.indexOf(prefix);
  return {
    budget: line('预算（用户填写）：'),
    deadline: line('交付时间（用户填写）：'),
    constraints: start >= 0 ? text.slice(start + prefix.length) : '',
  };
}
export function planningTasks(p: Exploration) {
  return aiStages.filter(
    (stage) =>
      !p.lab?.runs.some(
        (r) =>
          r.stage === stage &&
          r.status === 'succeeded' &&
          r.planningSignature === planningSignature(p, stage),
      ),
  );
}
export function planningConstraintText(p: Pick<Exploration, 'sources'>) {
  return (
    p.sources.find((s) => !s.removed && s.title === '规划约束（用户补充）')?.versions.at(-1)
      ?.text ?? ''
  );
}
export function criticalPlanningItems(p: Exploration) {
  return [
    ...(p.lab?.edges
      .filter(
        (e) => e.relationType === 'conflicts_with' && !['deleted', 'verified'].includes(e.status),
      )
      .map((e) => ({ id: e.id, text: e.rationale, version: e.revision })) ?? []),
    ...orderedQuestions(p)
      .filter(
        (q) =>
          q.priority.level === 'high' &&
          (q.decision?.answerNeedsReview || (q.status !== 'answered' && q.status !== 'excluded')),
      )
      .map((q) => ({
        id: q.id,
        text: q.title,
        version: digest([q.answer, q.status, q.evidenceIds]),
      })),
  ];
}
export const conflictSignature = (p: Exploration) => digest(criticalPlanningItems(p));
export function packageSignature(p: Exploration) {
  return digest([
    p.overview,
    p.lab?.activeSolutionIds,
    p.findings.map((f) => [f.id, f.revision, f.status]),
    p.lab?.solutions
      .filter((s) => p.lab!.activeSolutionIds.includes(s.id))
      .map((s) => [s.id, s.revision, s.status]),
    p.lab?.requirements
      .filter((r) => p.lab!.researchGuide.importRequirementIds.includes(r.id))
      .map((r) => [r.id, r.revision, r.status]),
    p.questions.map((q) => [q.id, q.status, q.answer]),
    conflictSignature(p),
  ]);
}
