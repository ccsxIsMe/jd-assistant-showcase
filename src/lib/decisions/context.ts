import { currentDecisions } from './records';
import type { Exploration } from '../exploration/model';
import type { Workspace } from '../workbench/model';
import { sameDecisionTopic, type DecisionQuestion } from './quality';
import type { DecisionContext } from './contracts';
import type { AnalysisRequest } from '../exploration/analysis';
import type { AIRequest } from '../workbench/ai-contract';
export function analysisDecisionContext(p: AnalysisRequest): DecisionContext {
  return {
    id: p.projectId,
    scope: 'research',
    objective: (
      p.overview.goal ||
      p.sources.find((s) => s.kind === 'text')?.versions.at(-1)?.text ||
      '当前研究'
    ).slice(0, 3000),
    facts: p.evidence.slice(0, 16).map((e) => ({
      id: e.evidenceId,
      text: e.excerpt.slice(0, 1500),
      revision: String(e.sourceRevision),
    })),
    answers: currentDecisions(p.questions)
      .slice(-100)
      .map((a) => ({
        id: a.id,
        title: a.title,
        topic: a.decisionSpec?.topic ?? '',
        ...(a.decisionSpec ? { decisionSpec: a.decisionSpec } : {}),
        answer: a.answer,
        status: a.status,
        ...(a.response ? { response: a.response } : {}),
      })),
  };
}
export function workbenchAIContext(p: AIRequest['context']): DecisionContext {
  return {
    id: p.id,
    scope: 'workbench',
    objective: p.title,
    facts: p.sources
      .filter((s) => !s.removed)
      .slice(0, 16)
      .map((s) => ({
        id: s.id,
        text: s.versions.at(-1)!.text.slice(0, 1500),
        revision: String(s.versions.at(-1)!.revision),
      })),
    answers: currentDecisions(p.questions ?? [])
      .slice(-100)
      .map((a) => ({
        id: a.id,
        title: a.title,
        topic: a.decisionSpec?.topic ?? '',
        ...(a.decisionSpec ? { decisionSpec: a.decisionSpec } : {}),
        answer: a.answer,
        status: a.status,
        ...(a.response ? { response: a.response } : {}),
      })),
  };
}
export function researchDecisionContext(
  p: Exploration,
  q?: DecisionQuestion & { evidenceIds?: string[]; findingIds?: string[] },
): DecisionContext {
  const evidence = p.evidence.filter(
    (e) =>
      !p.sources.find((s) => s.id === e.sourceId)?.removed &&
      p.sources.find((s) => s.id === e.sourceId)?.versions.at(-1)?.revision === e.sourceRevision,
  );
  const related = q?.evidenceIds?.length
    ? evidence.filter((e) => q.evidenceIds!.includes(e.evidenceId))
    : evidence;
  return {
    id: p.id,
    scope: 'research',
    objective: (p.overview.goal || p.initialObjective || p.title).slice(0, 3000),
    facts: related.slice(0, 16).map((e) => ({
      id: e.evidenceId,
      text: e.excerpt.slice(0, 1500),
      revision: String(e.sourceRevision),
    })),
    answers: currentDecisions(p.questions)
      .filter(
        (a) =>
          !q ||
          sameDecisionTopic(a, q) ||
          q.findingIds?.some((id) => a.findingIds.includes(id)) ||
          q.evidenceIds?.some((id) => a.evidenceIds.includes(id)),
      )
      .slice(-100)
      .map((a) => ({
        id: a.id,
        title: a.title,
        topic: a.decisionSpec?.topic ?? '',
        ...(a.decisionSpec ? { decisionSpec: a.decisionSpec } : {}),
        answer: a.answer,
        status: a.status,
        ...(a.response ? { response: a.response } : {}),
      })),
  };
}
export function workbenchDecisionContext(
  w: Workspace,
  q?: DecisionQuestion & { refs?: { sourceId: string }[]; targetIds?: string[] },
): DecisionContext {
  const sources = w.sources.filter(
    (s) => !s.removed && (!q?.refs?.length || q.refs.some((r) => r.sourceId === s.id)),
  );
  return {
    id: w.id,
    scope: 'workbench',
    objective: w.title.slice(0, 3000),
    facts: sources.slice(0, 16).map((s) => ({
      id: s.id,
      text: s.versions.at(-1)!.text.slice(0, 1500),
      revision: String(s.versions.at(-1)!.revision),
    })),
    answers: currentDecisions(w.questions)
      .filter(
        (a) =>
          !q ||
          sameDecisionTopic(a, q) ||
          q.targetIds?.some((id) => a.targetIds.includes(id)) ||
          q.refs?.some((r) => a.refs.some((ref) => ref.sourceId === r.sourceId)),
      )
      .slice(-100)
      .map((a) => ({
        id: a.id,
        title: a.title,
        topic: a.decisionSpec?.topic ?? '',
        ...(a.decisionSpec ? { decisionSpec: a.decisionSpec } : {}),
        answer: a.answer,
        status: a.status,
        ...(a.response ? { response: a.response } : {}),
      })),
  };
}
export function contextFingerprint(c: DecisionContext) {
  return JSON.stringify([c.id, c.objective, c.facts, c.answers]);
}
