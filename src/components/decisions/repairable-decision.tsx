'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { DecisionInput } from './decision-input';
import { Modal } from '../workbench/modal';
import { decisionFields, type DecisionResponse } from '@/lib/decisions/schema';
import {
  businessChoices,
  decisionFingerprint,
  questionSnapshot,
  type DecisionQuestion,
} from '@/lib/decisions/quality';
import {
  contextFingerprint,
  researchDecisionContext,
  workbenchDecisionContext,
} from '@/lib/decisions/context';
import type { DecisionContext } from '@/lib/decisions/contracts';
import type { Exploration } from '@/lib/exploration/model';
import type { Workspace, Question } from '@/lib/workbench/model';
import { applyResearchDecisionRepair, respondToResearchQuestion } from '@/lib/lab/operations';
import { applyWorkbenchDecisionRepair, respondToWorkbenchQuestion } from '@/lib/workbench/domain';
import { resolveDecision, decisionAnswer } from '@/lib/decisions/records';
const resultSchema = z.object({
  ok: z.boolean(),
  operationId: z.string(),
  questionId: z.string(),
  contextId: z.string(),
  questions: z.array(z.object({ ...decisionFields, title: z.string(), detail: z.string() })).max(2),
  issues: z.array(z.string()),
  promptVersion: z.string(),
  code: z.string().optional(),
  requestId: z.string().optional(),
});
function RepairableDecision({
  question: q,
  context,
  mode,
  onSave,
  onClear,
  onApply,
  disabled = false,
  manualText = false,
}: {
  question: DecisionQuestion & { id: string };
  context: DecisionContext;
  mode: 'real' | 'example';
  onSave: (r: DecisionResponse) => boolean | void;
  onClear?: () => void;
  onApply: (expected: string, contextVersion: string, questions: DecisionQuestion[]) => boolean;
  disabled?: boolean;
  manualText?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  async function repair() {
    if (controller.current) return;
    if (dirty.current) {
      setMessage('请先保存正在编辑的回答，再补全选项；输入已保留。');
      return;
    }
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setMessage('');
    setConsent(false);
    const expected = decisionFingerprint(q),
      version = contextFingerprint(context),
      operationId = crypto.randomUUID();
    try {
      const response = await fetch('/api/ai/decision-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId,
          question: questionSnapshot(q),
          context,
          mode,
          consent: true,
        }),
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(35000)]),
      });
      const body = await response.json();
      if (c.signal.aborted) return;
      if (dirty.current)
        throw new Error('你正在编辑回答，迟到的补全结果未应用；输入保留，请先保存后重试。');
      const parsed = resultSchema.safeParse(body);
      if (!parsed.success)
        throw new Error(
          typeof body.error === 'string' ? body.error : '选项响应结构不合法，原回答保留。',
        );
      const result = parsed.data;
      if (
        result.operationId !== operationId ||
        result.questionId !== q.id ||
        result.contextId !== context.id
      )
        throw new Error('补全结果不属于当前问题，未应用。');
      if (!response.ok || !result.ok || !result.questions.length)
        throw new Error(result.issues.join('；') || '该问题的可选方案尚未生成完成。');
      if (!onApply(expected, version, result.questions))
        throw new Error('问题、资料或回答已变化；迟到选项未应用，请重新补全。');
      setMessage('本题选项已更新；原回答与对应版本保留，有旧回答时请重新核对。');
    } catch (error) {
      setMessage(
        c.signal.aborted
          ? '已取消本题补全，已有内容保留。'
          : error instanceof Error
            ? error.message
            : '选项补全失败，已有内容保留。',
      );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  return (
    <div
      className="repairable-decision"
      data-decision-entry={q.id}
      data-decision-form={q.id}
      tabIndex={-1}
    >
      {q.decision?.answerNeedsReview && q.decision.mergedAnswers?.length && (
        <div role="status" className="decision-review">
          <strong>历史回答不一致，请在这里统一复核一次。</strong>
          {q.decision.mergedAnswers
            .filter((a) => a.answer)
            .map((a, i) => (
              <blockquote key={`${a.id}-${i}`}>
                {a.title}：{a.answer}
              </blockquote>
            ))}
        </div>
      )}
      <DecisionInput
        key={q.response ? 'answered' : 'empty'}
        label={q.title}
        question={q}
        choices={q.choices}
        recommendation={q.recommendation}
        response={q.response}
        draftKey={`${context.id}:${q.id}`}
        manualText={manualText}
        disabled={disabled}
        repairing={busy}
        onDraftDirty={(value) => {
          dirty.current = value;
        }}
        onRepair={() => {
          if (mode === 'real') setConsent(true);
          else void repair();
        }}
        onSave={onSave}
      />
      {q.response && onClear && (
        <details>
          <summary>当前回答操作</summary>
          <button onClick={onClear}>清除当前回答（可撤销）</button>
        </details>
      )}
      {busy && (
        <button className="decision-cancel" onClick={() => controller.current?.abort()}>
          取消本题补全
        </button>
      )}
      {message && (
        <p className="decision-repair-message" role="status">
          {message}
        </p>
      )}
      {consent && (
        <Modal title="仅补全这道题的选项" onClose={() => setConsent(false)}>
          <p>
            将本题、{context.facts.length}
            条相关资料摘录及已有回答发送至外部DeepSeek，可能计费。仅补全本题，不重跑整个研究；AI建议仍待你决定。
          </p>
          <div className="modal-actions">
            <button onClick={() => setConsent(false)}>取消</button>
            <button onClick={() => void repair()}>确认发送并补全选项</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function ResearchDecision({
  project: p,
  question: incoming,
  update,
  disabled,
  active = true,
}: {
  project: Exploration;
  question: Exploration['questions'][number];
  update: (fn: (p: Exploration) => Exploration) => boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  const q = resolveDecision(p.questions, incoming.id) ?? incoming;
  if (!active) return <p data-decision-summary={q.id}>当前记录：{decisionAnswer(q)}</p>;
  return (
    <RepairableDecision
      question={q}
      context={researchDecisionContext(p, q)}
      mode={p.mode}
      disabled={disabled}
      onSave={(r) => update((p) => respondToResearchQuestion(p, q.id, r))}
      onClear={() => update((p) => respondToResearchQuestion(p, q.id, null))}
      onApply={(expected, version, result) =>
        update((p) => applyResearchDecisionRepair(p, q.id, expected, version, result))
      }
    />
  );
}
export function WorkbenchDecision({
  workspace: w,
  question: incoming,
  update,
  editRequested = false,
}: {
  workspace: Workspace;
  question: Question;
  update: (fn: (w: Workspace) => Workspace) => boolean | void;
  editRequested?: boolean;
}) {
  const [editingInherited, setEditingInherited] = useState(false);
  const resolved = resolveDecision(w.questions, incoming.id) ?? incoming;
  const q: Question = resolved;
  // Manual/dependency questions do not depend on model-generated choices or
  // optional explanatory copy. This is a rendering capability, not a change
  // to the question, its generation status, history or validation rules.
  const manualText = q.kind !== 'potential' && businessChoices(q.choices).length === 0;
  if (
    q.decision?.inheritedFrom &&
    q.answer &&
    q.status === 'open' &&
    (!q.response || ['choice', 'custom'].includes(q.response.kind)) &&
    !editingInherited &&
    !editRequested
  )
    return (
      <div data-decision-entry={q.id}>
        <p>已沿用来源研究中的回答：{q.answer}</p>
        <p>来源快照：{q.decision.inheritedFrom.snapshotId}；岗位任务仍待确认。</p>
        <button
          onClick={() =>
            update((w) =>
              respondToWorkbenchQuestion(
                w,
                q.id,
                q.response ?? { kind: 'custom', choiceIds: [], text: q.answer },
              ),
            )
          }
        >
          确认沿用到当前岗位
        </button>
        <button onClick={() => setEditingInherited(true)}>修改适用答案</button>
      </div>
    );
  return (
    <RepairableDecision
      question={q}
      context={workbenchDecisionContext(w, q)}
      mode={w.mode}
      manualText={manualText}
      onSave={(r) => update((w) => respondToWorkbenchQuestion(w, q.id, r))}
      onClear={() => update((w) => respondToWorkbenchQuestion(w, q.id, null))}
      onApply={(expected, version, result) =>
        update((w) => applyWorkbenchDecisionRepair(w, q.id, expected, version, result)) !== false
      }
    />
  );
}
