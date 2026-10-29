'use client';
import { evidenceChain } from '@/lib/lab/graph';
import { evidenceValid } from '@/lib/exploration/domain';
import type { Exploration } from '@/lib/exploration/model';
import { currentDecisions } from '@/lib/decisions/records';
export function ChainDetails({
  project: p,
  onSource,
  onEdge,
}: {
  project: Exploration;
  onSource?: (id: string, evidenceId?: string) => void;
  onEdge?: (id: string) => void;
}) {
  const lab = p.lab!,
    id = lab.ui.focusedRequirementId;
  if (!id) return null;
  const r = lab.requirements.find((r) => r.id === id);
  if (!r) return null;
  const chain = evidenceChain(lab, `requirement:${r.id}`),
    proof = p.evidence.filter((e) => r.evidenceIds.includes(e.evidenceId)),
    inferences = p.findings.filter((f) => chain.has(`finding:${f.id}`) && f.basis === 'inferred'),
    questions = currentDecisions(p.questions).filter(
      (q) =>
        (chain.has(`question:${q.id}`) ||
          q.decision?.aliasIds?.some((id) => chain.has(`question:${id}`))) &&
        q.status !== 'excluded',
    ),
    conflicts = lab.edges.filter(
      (e) =>
        e.relationType === 'conflicts_with' &&
        e.status !== 'deleted' &&
        (chain.has(e.sourceNodeId) ||
          chain.has(e.targetNodeId) ||
          e.evidenceRefs.some((id) => r.evidenceIds.includes(id))),
    );
  return (
    <section className="lab-chain-details" aria-label="当前岗位要求的证据支持">
      <span className="guided-kicker">正在追溯</span>
      <h3>{r.title}</h3>
      <h4>原文依据 · {proof.filter((e) => evidenceValid(p, e)).length}条可定位</h4>
      {!proof.length && <p>缺少直接证据；此岗位要求仍是推断或待核实建议。</p>}
      {proof.map((e) => (
        <button
          key={e.evidenceId}
          onClick={() => e.sourceId && onSource?.(e.sourceId, e.evidenceId)}
        >
          <strong>
            {p.sources.find((s) => s.id === e.sourceId)?.title} · V{e.sourceRevision}
          </strong>
          <span>{e.excerpt.slice(0, 150)}</span>
          <small>{evidenceValid(p, e) ? '查看原始证据 ↗' : '证据需要复核'}</small>
        </button>
      ))}
      <h4>推断支持</h4>
      <p>{r.rationale}</p>
      {inferences.map((f) => (
        <p key={f.id}>
          {f.title}：{f.uncertainty || f.description}
        </p>
      ))}
      <h4>冲突与未决问题</h4>
      {conflicts.map((e) => (
        <button key={e.id} onClick={() => onEdge?.(e.id)}>
          核对双方依据：{e.rationale}
        </button>
      ))}
      {questions.map((q) => (
        <p key={q.id}>
          {q.title} ·{' '}
          {q.status === 'answered' ? '已回答' : q.status === 'deferred' ? '已暂缓' : '待回答'}{' '}
          {q.answer}
        </p>
      ))}
      {!conflicts.length && !questions.length && <p>暂未关联到问题，不代表资料已经完整。</p>}
    </section>
  );
}
