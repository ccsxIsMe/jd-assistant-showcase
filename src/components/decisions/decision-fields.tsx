'use client';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import type { DecisionResponse, DecisionChoice } from '@/lib/decisions/schema';
import { inspectDecision, type DecisionQuestion } from '@/lib/decisions/quality';
export type DecisionOption = DecisionChoice;
type PendingDraft = { kind: DecisionResponse['kind']; selected: string[]; text: string };
const DraftContext = createContext<Map<string, PendingDraft> | null>(null);
export function DecisionDrafts({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new Map<string, PendingDraft>());
  return <DraftContext.Provider value={cache}>{children}</DraftContext.Provider>;
}
export function DecisionInput({
  label,
  choices = [],
  recommendation,
  response,
  onSave,
  canSkip = true,
  disabled = false,
  multiple = false,
  question,
  onRepair,
  repairing = false,
  onDraftDirty,
  draftKey,
  manualText = false,
}: {
  label: string;
  choices?: DecisionOption[];
  recommendation?: { choiceId: string; reason: string };
  response?: DecisionResponse;
  onSave: (value: DecisionResponse) => boolean | void;
  canSkip?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  question?: DecisionQuestion;
  onRepair?: () => void;
  repairing?: boolean;
  onDraftDirty?: (dirty: boolean) => void;
  draftKey?: string;
  manualText?: boolean;
}) {
  const q = question ?? { title: label, choices, recommendation, response };
  const inspected = inspectDecision(q);
  const state = manualText ? { ...inspected, generation: 'text' as const, ready: true } : inspected;
  const name = useId();
  const legacyText = manualText ? q.answer || q.decisionSpec?.knownAnswer?.text || '' : '';
  const cache = useContext(DraftContext),
    cached = draftKey ? cache?.get(draftKey) : undefined;
  const [kind, setKind] = useState<DecisionResponse['kind']>(
      cached?.kind ?? response?.kind ?? 'choice',
    ),
    [selected, setSelected] = useState<string[]>(cached?.selected ?? response?.choiceIds ?? []),
    [text, setText] = useState(cached?.text ?? response?.text ?? legacyText),
    [dirty, setDirty] = useState(!!cached),
    [error, setError] = useState(''),
    [editingKnown, setEditingKnown] = useState(false);
  const currentKind = dirty ? kind : (response?.kind ?? kind),
    currentSelected = dirty ? selected : (response?.choiceIds ?? selected),
    currentText = dirty ? text : (response?.text ?? (legacyText || text));
  const suggestion = state.choices.find((c) => c.id === recommendation?.choiceId),
    ready = state.ready,
    known = state.generation === 'known' && !editingKnown;
  const multi = multiple || q.decisionSpec?.selection === 'multiple';
  useEffect(() => {
    onDraftDirty?.(dirty);
  }, [dirty, onDraftDirty]);
  function remember(next: DecisionResponse['kind'], ids = currentSelected, value = currentText) {
    if (draftKey) cache?.set(draftKey, { kind: next, selected: ids, text: value });
  }
  function edit(next: DecisionResponse['kind']) {
    remember(next);
    setKind(next);
    setSelected(currentSelected);
    setText(currentText);
    setDirty(true);
    onDraftDirty?.(true);
    setError('');
  }
  function save(next = currentKind) {
    if (next === 'custom' && !currentText.trim()) {
      setError('请填写自己的回答。');
      return;
    }
    const ids = next === 'choice' ? currentSelected : [];
    if (
      next === 'choice' &&
      (!ids.length || ids.some((id) => !state.choices.some((c) => c.id === id)))
    ) {
      setError('请选择一个实际业务选项，或明确保留未知。');
      return;
    }
    const ok = onSave({
      kind: next,
      choiceIds: ids,
      text: next === 'custom' || next === 'none' ? currentText : '',
      questionVersion: q.decision?.version ?? 1,
      optionsVersion: q.decision?.optionsVersion ?? 1,
    });
    if (ok !== false) {
      if (draftKey) cache?.delete(draftKey);
      setDirty(false);
      onDraftDirty?.(false);
      setKind(next);
      setError('');
    } else setError('决定未保存，请核对当前问题与选项版本。');
  }
  return (
    <fieldset className="decision-input" disabled={disabled} data-state={state.generation}>
      <legend>{label}</legend>
      {manualText && (
        <p className="decision-effect">
          请在“自己的回答”中填写或修改实际决定，再点击“保存这个决定”。
          尚未决定可以保留未知；历史问题涉及多件事时，请分别写明。
        </p>
      )}
      {q.decisionSpec?.explanation && (
        <p className="decision-effect">{q.decisionSpec.explanation}</p>
      )}
      {!!(q.decisionSpec?.knownFacts?.length || q.decisionSpec?.unknowns?.length) && (
        <details className="decision-basis">
          <summary>依据与待确认条件</summary>
          <p>以下为整理提示，仍需结合原文核对。</p>
          <ul>
            {q.decisionSpec?.knownFacts?.map((s, i) => (
              <li key={`known-${i}`}>已有依据：{s}</li>
            ))}
            {q.decisionSpec?.unknowns?.map((s, i) => (
              <li key={`unknown-${i}`}>尚待确定：{s}</li>
            ))}
          </ul>
        </details>
      )}
      {state.answerNeedsReview && (
        <div role="status" className="decision-review" data-testid="decision-answer-review">
          {manualText
            ? '已有回答需要重新核实；核实或修改后保存，不会自动采用旧答案。'
            : '选项已更新，原回答需复核，不会自动换成新选项。'}
          <blockquote>
            {q.answer ||
              response?.text ||
              response?.optionSnapshot
                ?.filter((c) => response.choiceIds.includes(c.id))
                .map((c) => c.label)
                .join('；')}
          </blockquote>
        </div>
      )}
      {known ? (
        <div className="decision-known">
          <strong>已根据你的资料填写，可修改</strong>
          <p>{q.decisionSpec?.knownAnswer?.text}</p>
          <button
            onClick={() => {
              setEditingKnown(true);
              edit('custom');
              setText(q.decisionSpec?.knownAnswer?.text ?? currentText);
            }}
          >
            修改已知信息
          </button>
        </div>
      ) : (
        <>
          {!ready && (
            <div className="decision-incomplete" role="status">
              <strong>
                {repairing ? '正在补全这道题的业务选项…' : '该问题的可选方案尚未生成完成。'}
              </strong>
              {state.issues.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
              {q.decision?.issues
                ?.filter((i) => !state.issues.includes(i))
                .map((issue, i) => (
                  <p key={`stored-${i}`}>{issue}</p>
                ))}
              <p>当前不是已完成的选择题；其他研究结果保留，可以先比较方案。</p>
              {onRepair && (
                <button disabled={repairing} onClick={onRepair}>
                  {repairing ? '补全中…' : '重新生成选项'}
                </button>
              )}
              <button onClick={() => edit('custom')}>直接补充想法</button>
              <button onClick={() => save('uncertain')}>保留未知并继续规划</button>
              {canSkip && <button onClick={() => save('skipped')}>暂缓此问题</button>}
            </div>
          )}
          {ready && state.generation !== 'text' && (
            <>
              {state.generation === 'suggestion' && (
                <p className="decision-explanation">一个建议方向 · 接受或修改，不是多选一。</p>
              )}
              <div className="decision-business-options" role="group" aria-label="业务选项">
                {state.choices.map((c) => (
                  <label className="decision-business-card" key={c.id}>
                    <input
                      name={`${name}-business`}
                      type={multi ? 'checkbox' : 'radio'}
                      checked={currentKind === 'choice' && currentSelected.includes(c.id)}
                      onChange={(e) => {
                        edit('choice');
                        setSelected(
                          multi
                            ? e.target.checked
                              ? [...currentSelected, c.id]
                              : currentSelected.filter((id) => id !== c.id)
                            : [c.id],
                        );
                        remember(
                          'choice',
                          multi
                            ? e.target.checked
                              ? [...currentSelected, c.id]
                              : currentSelected.filter((id) => id !== c.id)
                            : [c.id],
                        );
                      }}
                    />
                    <span>
                      <strong>{c.label}</strong>
                      {c.description && <small>{c.description}</small>}
                      <small>{c.impact}</small>
                      <em>
                        {c.sourceType === 'user_material'
                          ? '用户资料'
                          : c.sourceType === 'existing_answer'
                            ? '已有回答'
                            : c.sourceType === 'ai_suggestion'
                              ? 'AI建议方向 · 待确认'
                              : '候选方向 · 旧数据未记录来源'}
                      </em>
                    </span>
                  </label>
                ))}
              </div>
              {suggestion && recommendation && (
                <p className="decision-recommendation">
                  建议比较“{suggestion.label}”：{recommendation.reason}
                </p>
              )}
              <div className="decision-auxiliary" aria-label="辅助操作">
                {(['custom', 'uncertain'] as const)
                  .filter((value) => q.decision?.auxiliary[value] !== false)
                  .map((value) => (
                    <label key={value}>
                      <input
                        name={`${name}-auxiliary`}
                        type="radio"
                        checked={currentKind === value}
                        onChange={() => {
                          edit(value);
                          setSelected([]);
                        }}
                      />
                      <span>{value === 'custom' ? '其他，请填写' : '我不确定'}</span>
                    </label>
                  ))}
                <details>
                  <summary>其他处理方式</summary>
                  {state.choices.length >= 2 && q.decision?.auxiliary.none !== false && (
                    <label>
                      <input
                        name={`${name}-auxiliary`}
                        type="radio"
                        checked={currentKind === 'none'}
                        onChange={() => {
                          edit('none');
                          setSelected([]);
                        }}
                      />
                      以上都不适用
                    </label>
                  )}
                  {canSkip && q.decision?.auxiliary.skip !== false && (
                    <label>
                      <input
                        name={`${name}-auxiliary`}
                        type="radio"
                        checked={currentKind === 'skipped'}
                        onChange={() => {
                          edit('skipped');
                          setSelected([]);
                        }}
                      />
                      暂时跳过
                    </label>
                  )}
                </details>
              </div>
            </>
          )}
          {(currentKind === 'custom' || currentKind === 'none' || state.generation === 'text') && (
            <label>
              {currentKind === 'none' ? '补充偏好（可选）' : '自己的回答'}
              <textarea
                aria-label={`${label}：自己的回答`}
                rows={3}
                maxLength={4000}
                value={currentText}
                onChange={(e) => {
                  edit(currentKind === 'none' ? 'none' : 'custom');
                  setText(e.target.value);
                  remember(currentKind === 'none' ? 'none' : 'custom', [], e.target.value);
                }}
              />
            </label>
          )}
          {currentKind === 'uncertain' && (
            <p className="decision-explanation">
              保留未知，不会记为已确认。
              {q.decision?.provisional
                ? `AI暂定建议，可修改：“${q.decision.provisional.label}”——${q.decision.provisional.reason}`
                : suggestion
                  ? `AI暂定建议，可修改：“${suggestion.label}”——${recommendation!.reason}`
                  : '可以继续比较带明确假设的方案，不要求立即决定。'}
            </p>
          )}
          {(ready || currentKind === 'custom') && (
            <button
              className="lab-primary"
              onClick={() => save(state.generation === 'text' ? 'custom' : currentKind)}
            >
              {state.generation === 'suggestion' && currentKind === 'choice'
                ? '接受这个建议'
                : '保存这个决定'}
            </button>
          )}
          {state.generation === 'text' && (
            <div className="decision-auxiliary" aria-label="保留未知或暂缓">
              <button onClick={() => save('uncertain')}>我还不确定</button>
              {canSkip && <button onClick={() => save('skipped')}>暂缓这项问题</button>}
            </div>
          )}
          {ready && response?.kind === 'none' && onRepair && (
            <button disabled={repairing} onClick={onRepair}>
              {repairing ? '补全中…' : '重新提出方向（考虑被否定的选项）'}
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {response && (
        <small className="decision-saved">
          已记录：
          {
            {
              choice: '你的业务选项',
              custom: '你的补充',
              uncertain: '未知，待确认',
              skipped: '暂缓',
              none: '现有版本选项不适用',
            }[response.kind]
          }{' '}
          · 选项版本{response.optionsVersion ?? 1}
        </small>
      )}
    </fieldset>
  );
}
