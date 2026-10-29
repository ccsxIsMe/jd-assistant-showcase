'use client';
import { currentDecisions } from '@/lib/decisions/records';
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  GitCompareArrows,
  MessageSquare,
  Send,
  Sparkles,
  Undo2,
  X,
  LockKeyhole,
  AlertCircle,
  Link2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { References } from './items-panel';
import { TextDiff } from './diff';
import { Modal } from './modal';
import { RequestErrorNotice, type ErrorDetail } from './request-error-notice';
import { WorkbenchDecision } from '../decisions/repairable-decision';
import {
  applySuggestion,
  log,
  rejectSuggestion,
  suggestionStale,
  touch,
  undoOperation,
  setWorkbenchQuestionStatus,
} from '@/lib/workbench/domain';
import {
  now,
  uid,
  type ItemFields,
  type Question,
  type Reference,
  type Suggestion,
  type Workspace,
} from '@/lib/workbench/model';
function SuggestionCard({
  s,
  w,
  update,
  onReference,
}: {
  s: Suggestion;
  w: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  onReference: (r: Reference) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, ItemFields>>({});
  const stale = s.status === 'stale' || suggestionStale(w, s);
  const undone = w.operations.some((o) => o.suggestionId === s.suggestionId && o.undone);
  const labels = {
    pending: '待审阅',
    applied: '已应用到草稿',
    rejected: '已拒绝',
    stale: '已过期',
    failed: '失败',
  };
  return (
    <article
      data-tour="workbench-review-suggestion"
      className={`suggestion-card ${s.status}`}
      data-testid="suggestion-card"
    >
      <div className="suggestion-top">
        <span>
          <GitCompareArrows size={14} />
          {s.changes.length > 1 ? `关联建议组 · ${s.changes.length} 项` : '独立建议'}
        </span>
        <b>{undone ? '已撤销' : labels[stale && s.status === 'pending' ? 'stale' : s.status]}</b>
      </div>
      <p className="suggestion-group-reason">{s.groupReason}</p>
      {s.changes.length > 1 && (
        <p className="callout warning tiny">
          本组必须一起生效；应用前任一目标不满足条件，整组保持原状。
        </p>
      )}
      {s.changes.map((c) => (
        <section key={c.targetId} className="suggestion-change">
          <h4>{w.items.find((i) => i.id === c.targetId)?.title ?? c.before.title}</h4>
          <p>{c.reason}</p>
          {c.operation === 'exclude' ? (
            <div className="exclude-diff">
              <span>保留原文记录</span>
              <del>{c.before.text}</del>
              <strong>建议：排除本项，不直接删除历史</strong>
            </div>
          ) : (
            <TextDiff
              before={[c.before.title, c.before.text, c.before.scope].filter(Boolean).join('\n')}
              after={[
                (edits[c.targetId] ?? c.after).title,
                (edits[c.targetId] ?? c.after).text,
                (edits[c.targetId] ?? c.after).scope,
              ]
                .filter(Boolean)
                .join('\n')}
            />
          )}
          {c.after.category !== c.before.category && (
            <p className="tiny">
              条件分类：{c.before.category} → {c.after.category}
            </p>
          )}
          <References refs={c.refs} onReference={onReference} />
          {editing && (
            <div className="suggestion-edit">
              <label>
                采纳前编辑标题
                <Input
                  aria-label={`建议标题${c.targetId}`}
                  value={(edits[c.targetId] ?? c.after).title}
                  maxLength={300}
                  onChange={(e) =>
                    setEdits({
                      ...edits,
                      [c.targetId]: { ...(edits[c.targetId] ?? c.after), title: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                采纳前编辑内容
                <Textarea
                  aria-label={`建议内容${c.targetId}`}
                  value={(edits[c.targetId] ?? c.after).text}
                  maxLength={10000}
                  rows={5}
                  onChange={(e) =>
                    setEdits({
                      ...edits,
                      [c.targetId]: { ...(edits[c.targetId] ?? c.after), text: e.target.value },
                    })
                  }
                />
              </label>
            </div>
          )}
        </section>
      ))}
      {s.error && <p className="callout error">{s.error}</p>}
      {s.status === 'pending' && !stale ? (
        <div className="suggestion-actions">
          <Button
            onClick={() =>
              update((c) => applySuggestion(c, s.suggestionId, editing ? edits : undefined))
            }
          >
            <Check size={13} />
            {s.changes.length > 1 ? '应用整组' : editing ? '应用编辑后内容' : '应用本条'}
          </Button>
          <button className="text-button" onClick={() => setEditing(!editing)}>
            {editing ? '取消编辑' : '编辑后采纳'}
          </button>
          <button
            className="text-button"
            onClick={() => update((c) => rejectSuggestion(c, s.suggestionId))}
          >
            <X size={12} />
            拒绝
          </button>
        </div>
      ) : (
        stale &&
        s.status !== 'applied' && (
          <p className="callout warning tiny">
            目标、锁定状态或引用依据已变化。请重新生成，禁止覆盖当前编辑。
          </p>
        )
      )}
      {s.status === 'applied' && (
        <button
          className="text-button"
          onClick={() => {
            const op = w.operations.find((o) => o.suggestionId === s.suggestionId && !o.undone);
            if (op) update((c) => undoOperation(c, op.id));
          }}
          disabled={!w.operations.some((o) => o.suggestionId === s.suggestionId && !o.undone)}
        >
          <Undo2 size={13} />
          撤销本次应用
        </button>
      )}
    </article>
  );
}
function QuestionCard({
  q,
  workspace: w,
  update,
  onReference,
  onSelect,
  focusToken,
}: {
  q: Question;
  workspace: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  onReference: (r: Reference) => void;
  onSelect: (id: string) => void;
  focusToken?: number;
}) {
  const [expanded, setExpanded] = useState(
    q.important && (q.status === 'open' || !!q.decision?.answerNeedsReview),
  );
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusToken === undefined) return;
    let focusFrame = 0;
    const frame = requestAnimationFrame(() => {
      setExpanded(true);
      focusFrame = requestAnimationFrame(() => {
        const target =
          card.current?.querySelector<HTMLElement>(
            'textarea, input, [data-decision-entry] button',
          ) ?? card.current;
        target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        target?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
    };
  }, [focusToken]);
  const [error, setError] = useState('');
  function patch(fields: Partial<Question>) {
    if (fields.status === 'open') update((c) => setWorkbenchQuestionStatus(c, q.id, 'open'));
  }
  function resolve(status: Question['status']) {
    if ((status === 'resolved' || status === 'ignored') && !q.answer.trim()) {
      setError(
        status === 'ignored'
          ? '重要问题忽略前请填写理由；不会伪造审批。'
          : '请记录实际回答或决定后再解决。',
      );
      return;
    }
    if (status === 'ignored') update((c) => setWorkbenchQuestionStatus(c, q.id, 'ignored'));
    setError('');
  }
  return (
    <article
      ref={card}
      tabIndex={-1}
      id={`question-${q.id}`}
      className={`question-card ${q.status}`}
    >
      <button
        data-review-question-title={
          q.important &&
          (q.decision?.answerNeedsReview || !['resolved', 'ignored'].includes(q.status))
            ? ''
            : undefined
        }
        className="question-title"
        aria-expanded={expanded}
        aria-controls={`question-answer-${q.id}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="question-icon">
          {q.status === 'resolved' && !q.decision?.answerNeedsReview ? (
            <Check size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
        </span>
        <strong>{q.title}</strong>
        <ChevronDown size={14} />
      </button>
      <div className="question-tags">
        <span>
          {q.kind === 'dependency'
            ? '程序检测 · 依赖变化'
            : q.kind === 'potential'
              ? 'AI提示 · 建议确认'
              : '人工问题'}
        </span>
        <b>
          {q.decision?.answerNeedsReview
            ? '需复核'
            : { open: '待澄清', resolved: '已澄清', deferred: '已暂缓', ignored: '已忽略' }[
                q.status
              ]}
        </b>
      </div>
      {!expanded && (
        <button className="text-button" onClick={() => setExpanded(true)}>
          {q.status === 'resolved' && !q.decision?.answerNeedsReview
            ? '查看或修改已保存回答'
            : '填写或复核回答'}
        </button>
      )}
      {expanded && (
        <div id={`question-answer-${q.id}`}>
          <p className="question-detail">{q.detail}</p>
          <References refs={q.refs} onReference={onReference} />
          <WorkbenchDecision
            workspace={w}
            question={q}
            update={update}
            editRequested={focusToken !== undefined}
          />
          {q.targetIds.length > 0 && (
            <div className="relationship-row">
              {q.targetIds.map((id) => (
                <button key={id} onClick={() => onSelect(id)}>
                  <Link2 size={12} />
                  查看并确认关联内容
                </button>
              ))}
            </div>
          )}
          {error && <p className="callout error tiny">{error}</p>}
          <div className="question-actions">
            {q.status !== 'open' && (
              <button className="text-button" onClick={() => patch({ status: 'open' })}>
                重新打开
              </button>
            )}
            {q.response?.kind === 'custom' && (
              <button className="text-button" onClick={() => resolve('ignored')}>
                排除并保留已保存理由
              </button>
            )}
          </div>
          {w.operations.find((o) => !o.undone && o.questionsAfter?.some((v) => v.id === q.id)) && (
            <button
              onClick={() =>
                update((c) =>
                  undoOperation(
                    c,
                    c.operations.find(
                      (o) => !o.undone && o.questionsAfter?.some((v) => v.id === q.id),
                    )!.id,
                  ),
                )
              }
            >
              撤销这次问题选择
            </button>
          )}
          <p className="tiny muted">
            请在上方记录或确认决定。关联条目仍需单独检查并点击“确认”；若答案改变了内容，先人工编辑或请求局部建议。JD
            需单独生成 / 更新。
          </p>
        </div>
      )}
    </article>
  );
}
export function ReviewPanel({
  w,
  update,
  onReference,
  select,
  onRun,
  busy,
  cancel,
  aiError,
  errorDetail,
  retryAI,
  intent,
  setIntent,
  tab,
  setTab,
  questionFocus,
}: {
  w: Workspace;
  update: (fn: (w: Workspace) => Workspace) => void;
  onReference: (r: Reference) => void;
  select: (id: string) => void;
  onRun: () => void;
  busy: boolean;
  cancel: () => void;
  aiError: string;
  errorDetail: ErrorDetail | null;
  retryAI: () => void;
  intent: string;
  setIntent: (v: string) => void;
  tab: 'ai' | 'questions' | 'discussion';
  setTab: (v: 'ai' | 'questions' | 'discussion') => void;
  questionFocus?: { id: string; token: number } | null;
}) {
  const selected = w.items.find((i) => i.id === w.ui.selectedId);
  const [comment, setComment] = useState('');
  const [author, setAuthor] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [onlyRelated, setOnlyRelated] = useState(false);
  useEffect(() => {
    if (!questionFocus) return;
    const frame = requestAnimationFrame(() => setOnlyRelated(false));
    return () => cancelAnimationFrame(frame);
  }, [questionFocus]);
  const [questionForm, setQuestionForm] = useState(false);
  const [questionTitle, setQuestionTitle] = useState('');
  const [questionDetail, setQuestionDetail] = useState('');
  const suggestions = w.suggestions
    .filter(
      (s) =>
        all ||
        s.changes.some((c) => c.targetId === selected?.id) ||
        s.preconditions.some((p) => p.targetId === selected?.id),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'pending') - Number(a.status === 'pending') ||
        Number(b.changes.length > 1) - Number(a.changes.length > 1),
    );
  const questions = currentDecisions(w.questions).filter(
    (q) => !onlyRelated || !selected || !q.targetIds.length || q.targetIds.includes(selected.id),
  );
  const comments = w.comments.filter((c) => c.targetId === (selected?.id ?? w.id));
  return (
    <>
      <div className="panel-title">
        <span>
          <Sparkles size={16} />
          共创助手
        </span>
        <span className={`mode-pill ${w.mode}`}>
          {w.mode === 'example' ? '预置响应' : '真实AI'}
        </span>
      </div>
      <div className="review-tabs" role="tablist" aria-label="共创助手视图">
        <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
          修改建议 <b>{w.suggestions.filter((s) => s.status === 'pending').length}</b>
        </button>
        <button role="tab" aria-selected={tab === 'questions'} onClick={() => setTab('questions')}>
          问题澄清{' '}
          <b>
            {
              currentDecisions(w.questions).filter(
                (q) => q.status === 'open' || q.status === 'deferred',
              ).length
            }
          </b>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'discussion'}
          onClick={() => setTab('discussion')}
        >
          意见记录
        </button>
      </div>
      {tab === 'ai' && (
        <div className="review-body">
          <div className="selection-context">
            <span>当前选中</span>
            <strong>{selected?.title ?? '尚未选择工作对象'}</strong>
            {selected?.locked && (
              <small>
                <LockKeyhole size={12} />
                已锁定，AI不能修改
              </small>
            )}
          </div>
          <label className="intent-label" htmlFor="local-intent">
            这一次，你想调整什么？
          </label>
          <Textarea
            id="local-intent"
            data-tour="workbench-local-ai"
            rows={4}
            maxLength={4000}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="例如：精简当前段落，保留已确认任务与能力，不增加新的承诺。"
          />
          <div className="ai-request-actions">
            <Button
              onClick={onRun}
              disabled={busy || !selected || selected.locked || !intent.trim()}
            >
              <Sparkles size={14} />
              {busy ? 'AI处理中…' : '生成局部修改建议'}
            </Button>
            {busy && (
              <button className="text-button" onClick={cancel}>
                取消
              </button>
            )}
          </div>
          <p className="tiny muted">
            {w.mode === 'example'
              ? w.demo
                ? '示例项目｜虚构材料｜预置分析结果；局部示例仅覆盖精简，其他意图请人工编辑或主动使用真实AI。'
                : '旧版虚构案例兼容响应，仅覆盖其明确的岗位边界与精简演示。'
              : '确认点击后，将相关资料与岗位内容发送至外部DeepSeek服务，按服务商计费；请先审阅资料。'}
            {busy ? ' 正在等待结构化结果；可继续人工编辑。' : ''}
          </p>
          {aiError && (
            <RequestErrorNotice
              className="callout error"
              message={aiError}
              detail={errorDetail}
              onRetry={retryAI}
            />
          )}
          <div className="suggestion-list-heading">
            <h3>审阅修改</h3>
            <label>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              全部对象
            </label>
          </div>
          {suggestions.length ? (
            <>
              {suggestions.slice(0, 3).map((s) => (
                <SuggestionCard
                  key={s.suggestionId}
                  s={s}
                  w={w}
                  update={update}
                  onReference={onReference}
                />
              ))}
              {suggestions.length > 3 && (
                <details className="secondary-suggestions">
                  <summary>展开其他{suggestions.length - 3}条建议与记录</summary>
                  {suggestions.slice(3).map((s) => (
                    <SuggestionCard
                      key={s.suggestionId}
                      s={s}
                      w={w}
                      update={update}
                      onReference={onReference}
                    />
                  ))}
                </details>
              )}
            </>
          ) : (
            <div className="compact-empty">
              <GitCompareArrows size={25} />
              <strong>先看差异，再决定</strong>
              <p>AI只提出建议。你可以单条应用、编辑后采纳，或拒绝。内容不会在预览时改变。</p>
            </div>
          )}
          {w.operations.find((o) => o.suggestionId && !o.undone) && (
            <button
              className="undo-banner"
              onClick={() =>
                update((c) =>
                  undoOperation(c, c.operations.find((o) => o.suggestionId && !o.undone)!.id),
                )
              }
            >
              <Undo2 size={14} />
              撤销最近一次AI应用
            </button>
          )}
        </div>
      )}
      {tab === 'questions' && (
        <div className="review-body">
          <div className="right-note">
            这里澄清“信息是否清楚”；中间条目确认“是否采纳为岗位内容”。
            <br />
            回答会自动保存，不会自动确认条目或改写 JD。先检查关联内容，再确认，最后生成 / 更新 JD。
          </div>
          <div className="questions-toolbar">
            <label>
              <input
                type="checkbox"
                checked={onlyRelated}
                onChange={(e) => setOnlyRelated(e.target.checked)}
              />
              仅看当前对象
            </label>
            <button className="text-button" onClick={() => setQuestionForm(true)}>
              新增问题
            </button>
          </div>
          {questions.length ? (
            questions.map((q) => (
              <QuestionCard
                key={q.id}
                focusToken={questionFocus?.id === q.id ? questionFocus.token : undefined}
                q={q}
                workspace={w}
                update={update}
                onReference={onReference}
                onSelect={select}
              />
            ))
          ) : (
            <div className="compact-empty">
              <Check size={24} />
              <strong>当前没有相关问题</strong>
              <p>可从“更多”整理问题，或在意见记录中补充人工疑问。</p>
            </div>
          )}
        </div>
      )}
      {tab === 'discussion' && (
        <div className="review-body">
          <div className="selection-context">
            <span>意见关联到</span>
            <strong>{selected?.title ?? '整个岗位'}</strong>
          </div>
          <p className="tiny muted">
            没有多人账号体系。以下内容标为本地操作者或用户录入的反馈，不代表真实负责人审批。
          </p>
          {comments.map((c) => (
            <article key={c.id} className="comment-card">
              <div>
                <strong>{c.author}</strong>
                <span>
                  {new Date(c.createdAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {c.replyTo && (
                <small>回复：{w.comments.find((x) => x.id === c.replyTo)?.text.slice(0, 70)}</small>
              )}
              <p>{c.text}</p>
              <button className="text-button" onClick={() => setReplyTo(c.id)}>
                回复
              </button>
            </article>
          ))}
          {!comments.length && (
            <div className="compact-empty">
              <MessageSquare size={25} />
              <p>
                记录真正的沟通结论，
                <br />
                让岗位决定有上下文。
              </p>
            </div>
          )}
          <form
            className="comment-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              update((c) => {
                const n = structuredClone(c);
                n.comments.push({
                  id: uid(),
                  targetId: selected?.id ?? w.id,
                  replyTo,
                  author: author.trim() ? `用户录入反馈：${author.trim()}` : '本地操作者',
                  text: comment.trim(),
                  createdAt: now(),
                });
                log(n, '记录本地意见或用户录入反馈');
                return touch(n);
              });
              setComment('');
              setReplyTo(null);
            }}
          >
            {replyTo && (
              <button className="text-button" type="button" onClick={() => setReplyTo(null)}>
                正在回复 · 取消
              </button>
            )}
            <Input
              aria-label="反馈来源"
              maxLength={200}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="反馈来源（可选，非登录身份）"
            />
            <Textarea
              aria-label="意见内容"
              required
              maxLength={5000}
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="记录意见、实际反馈或需要询问的问题…"
            />
            <Button type="submit">
              <Send size={13} />
              保存意见
            </Button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              const text = w.questions
                .filter((q) => q.status === 'open' || q.status === 'deferred')
                .map((q, index) => `${index + 1}. ${q.title}\n${q.detail}`)
                .join('\n\n');
              void navigator.clipboard.writeText(text || '暂无待询问事项');
            }}
          >
            复制待询问事项
          </button>
        </div>
      )}
      {questionForm && (
        <Modal title="记录待确认问题" onClose={() => setQuestionForm(false)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!questionTitle.trim()) return;
              update((c) => {
                const n = structuredClone(c);
                n.questions.push({
                  id: uid(),
                  title: questionTitle,
                  detail: questionDetail,
                  kind: 'human',
                  important: true,
                  targetIds: selected ? [selected.id] : [],
                  refs: selected?.refs ?? [],
                  status: 'open',
                  answer: '',
                  reason: '',
                  createdAt: now(),
                });
                log(n, '新增人工待确认问题');
                return touch(n);
              });
              setQuestionForm(false);
              setQuestionTitle('');
              setQuestionDetail('');
            }}
          >
            <label>
              需要决定的问题
              <Input
                aria-label="需要决定的问题"
                required
                maxLength={300}
                value={questionTitle}
                onChange={(e) => setQuestionTitle(e.target.value)}
              />
            </label>
            <label>
              问题背景
              <Textarea
                aria-label="问题背景"
                rows={4}
                maxLength={3000}
                value={questionDetail}
                onChange={(e) => setQuestionDetail(e.target.value)}
              />
            </label>
            <Button type="submit">保存待确认问题</Button>
          </form>
        </Modal>
      )}{' '}
    </>
  );
}
