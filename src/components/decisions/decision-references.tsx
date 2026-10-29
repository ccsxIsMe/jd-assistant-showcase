'use client';
import type { Exploration } from '@/lib/exploration/model';
import { currentDecisions, decisionAnswer } from '@/lib/decisions/records';
export function DecisionReferences({
  project: p,
  onAnswer,
  readonly = false,
}: {
  project: Exploration;
  onAnswer?: (id: string) => void;
  readonly?: boolean;
}) {
  const questions = currentDecisions(p.questions);
  if (!questions.length) return null;
  return (
    <details className="decision-references">
      <summary>关联决定与已有答案 · {questions.length}项</summary>
      {questions.map((q) => (
        <article key={q.id} data-decision-reference={q.id}>
          <strong>{q.title}</strong>
          <p>{q.decisionSpec?.explanation || q.detail}</p>
          <p>
            {q.decision?.answerNeedsReview
              ? '需复核'
              : q.response?.kind === 'uncertain'
                ? '尚不确定'
                : q.status === 'deferred'
                  ? '已暂缓'
                  : q.status === 'excluded'
                    ? '已排除'
                    : q.status === 'answered'
                      ? '已回答'
                      : '待决定'}{' '}
            · 当前记录：{decisionAnswer(q)}
            {q.decision?.answerNeedsReview ? ' · 需复核' : ''}
          </p>
          {!readonly && onAnswer && (
            <button onClick={() => onAnswer(q.id)}>
              {q.answer ? '修改这个决定' : '去选择这个决定'}
            </button>
          )}
        </article>
      ))}
    </details>
  );
}
