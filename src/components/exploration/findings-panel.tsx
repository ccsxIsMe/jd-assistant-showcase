'use client';
import { useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Link as LinkIcon,
  LockKeyhole,
  Pencil,
  Plus,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Modal } from '../workbench/modal';
import { recordResearchChange } from '@/lib/exploration/journal';
import {
  basisNames,
  findingKindNames,
  makeId,
  type Exploration,
  type Finding,
} from '@/lib/exploration/model';
import { changeFinding, evidenceValid, touchExploration } from '@/lib/exploration/domain';
import { ResearchDecision } from '../decisions/repairable-decision';
import { currentDecisions, decisionAnswer } from '@/lib/decisions/records';
type Props = {
  project: Exploration;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  jumpEvidence: (id: string) => void;
  select: (id: string) => void;
};
const statuses = { pending: '待确认', review: '需复核', confirmed: '已确认', excluded: '已排除' };
export function FindingsPanel({ project: p, update, jumpEvidence, select }: Props) {
  const [editing, setEditing] = useState<Finding | null>(null);
  const view = p.ui.view;
  const shown = p.findings.filter((f) =>
    view === 'features'
      ? ['feature', 'scenario', 'goal'].includes(f.kind)
      : view === 'conflicts'
        ? f.kind === 'conflict'
        : view === 'risks'
          ? ['condition', 'risk'].includes(f.kind) || f.basis === 'inferred'
          : true,
  );
  function reorder(id: string, delta: number) {
    update((current) => {
      const n = structuredClone(current);
      const list = n.findings.filter((f) => shown.some((s) => s.id === f.id));
      const position = list.findIndex((f) => f.id === id);
      const other = list[position + delta];
      if (!other) return n;
      const a = n.findings.findIndex((f) => f.id === id);
      const b = n.findings.findIndex((f) => f.id === other.id);
      [n.findings[a], n.findings[b]] = [n.findings[b], n.findings[a]];
      return touchExploration(n, '人工调整需求排序');
    });
  }
  function newFinding() {
    setEditing({
      id: makeId(),
      revision: 1,
      kind: view === 'conflicts' ? 'conflict' : view === 'risks' ? 'risk' : 'feature',
      title: '',
      description: '',
      behavior: '',
      outcome: '',
      basis: 'inferred',
      priority: 'medium',
      phase: 'mvp',
      status: 'pending',
      locked: false,
      evidenceIds: [],
      parentId: null,
      origin: 'user',
    });
  }
  return (
    <section className="explore-findings">
      <div className="explore-section-heading">
        <div>
          <h2>
            {view === 'features'
              ? '功能清单'
              : view === 'conflicts'
                ? '来源冲突'
                : '推断与实施条件'}
          </h2>
          <p>确认表示采纳内容；它不会直接创建岗位任务或要求。</p>
        </div>
        <Button variant="outline" onClick={newFinding}>
          <Plus size={16} />
          新增结论
        </Button>
      </div>
      {!shown.length && (
        <div className="explore-empty">
          <LinkIcon size={28} />
          <h3>{view === 'conflicts' ? '暂无冲突记录' : '先让每项需求有据可查'}</h3>
          <p>
            {view === 'conflicts'
              ? '没有记录不代表资料绝无冲突。可人工添加双方证据与待决定问题。'
              : '添加来源并分析，或先手动建立一个待确认结论。'}
          </p>
        </div>
      )}
      {shown.map((f, index) => (
        <article
          data-testid="explore-finding"
          id={`finding-${f.id}`}
          key={f.id}
          className={`explore-finding-card ${p.ui.findingId === f.id ? 'selected' : ''}`}
        >
          <header>
            <button onClick={() => select(f.id)}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{f.title}</h3>
            </button>
            <span className={`finding-status ${f.status}`}>
              {f.locked && <LockKeyhole size={13} />}
              {statuses[f.status]}
            </span>
          </header>
          <div className="finding-tags">
            <span>{findingKindNames[f.kind]}</span>
            <span className={f.basis === 'inferred' ? 'inference' : ''}>{basisNames[f.basis]}</span>
            <span>{{ high: '高', medium: '中', low: '低' }[f.priority]}优先级</span>
            <span>{{ mvp: '第一阶段', next: '下一阶段', later: '后续考虑' }[f.phase]}</span>
          </div>
          <p>{f.description}</p>
          {f.behavior && (
            <p>
              <b>用户行为：</b>
              {f.behavior}
            </p>
          )}
          {f.outcome && (
            <p>
              <b>预期结果：</b>
              {f.outcome}
            </p>
          )}
          <div className="finding-evidence-links">
            {f.evidenceIds.map((id) => {
              const e = p.evidence.find((e) => e.evidenceId === id);
              return (
                <button key={id} onClick={() => jumpEvidence(id)}>
                  <LinkIcon size={13} />
                  {e?.title ?? '证据缺失'}
                  {!e || !evidenceValid(p, e) ? ' · 待核实 / 已过期' : ''}
                </button>
              );
            })}
            {!f.evidenceIds.length && (
              <span>无直接证据：{f.basis === 'inferred' ? '推断待确认' : '请补充依据'}</span>
            )}
          </div>
          <footer>
            <button
              disabled={f.locked}
              className="confirm-button"
              onClick={() =>
                update((current) => changeFinding(current, f.id, { status: 'confirmed' }))
              }
            >
              <Check size={14} />
              {f.basis === 'excluded' ? '确认不借鉴' : '确认内容'}
            </button>
            <button disabled={f.locked} onClick={() => setEditing(structuredClone(f))}>
              <Pencil size={14} />
              编辑
            </button>
            <button
              onClick={() =>
                update((current) => changeFinding(current, f.id, { locked: !f.locked }))
              }
            >
              <LockKeyhole size={14} />
              {f.locked ? '解锁' : '锁定'}
            </button>
            <button
              disabled={f.locked}
              onClick={() =>
                update((current) =>
                  changeFinding(current, f.id, {
                    status: f.status === 'excluded' ? 'pending' : 'excluded',
                  }),
                )
              }
            >
              {f.status === 'excluded' ? '恢复待确认' : '排除'}
            </button>
            <span />
            <button
              aria-label={`上移${f.title}`}
              disabled={index === 0}
              onClick={() => reorder(f.id, -1)}
            >
              <ChevronUp size={16} />
            </button>
            <button
              aria-label={`下移${f.title}`}
              disabled={index === shown.length - 1}
              onClick={() => reorder(f.id, 1)}
            >
              <ChevronDown size={16} />
            </button>
          </footer>
        </article>
      ))}
      {editing && (
        <FindingEditor
          project={p}
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            const exists = p.findings.some((f) => f.id === item.id);
            const ok = update((current) => {
              if (exists) {
                const saved = current.findings.find((f) => f.id === item.id);
                if (!saved || saved.revision !== editing.revision)
                  throw new Error('结论已有新编辑，请重新打开。');
                return changeFinding(current, item.id, {
                  title: item.title,
                  description: item.description,
                  behavior: item.behavior,
                  outcome: item.outcome,
                  basis: item.basis,
                  priority: item.priority,
                  phase: item.phase,
                  kind: item.kind,
                  evidenceIds: item.evidenceIds,
                  parentId: item.parentId,
                  rationale: item.rationale,
                  uncertainty: item.uncertainty,
                });
              }
              const n = structuredClone(current);
              n.findings.push(item);
              return touchExploration(n, '人工新增待确认结论');
            });
            if (ok) setEditing(null);
          }}
        />
      )}
    </section>
  );
}
function FindingEditor({
  project: p,
  item,
  onSave,
  onClose,
}: {
  project: Exploration;
  item: Finding;
  onSave: (f: Finding) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const patch = (fields: Partial<Finding>) => setDraft((current) => ({ ...current, ...fields }));
  return (
    <Modal title={item.title ? '编辑产品结论' : '新增产品结论'} onClose={onClose}>
      <form
        className="form-stack exploration-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <label>
          结论名称
          <input
            className="field"
            aria-label="结论名称"
            required
            maxLength={200}
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>
        <label>
          需求说明
          <textarea
            className="field"
            aria-label="需求说明"
            rows={4}
            maxLength={4000}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            结论类型
            <select
              className="field"
              value={draft.kind}
              onChange={(e) => patch({ kind: e.target.value as Finding['kind'] })}
            >
              {Object.entries(findingKindNames).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            事实与推断
            <select
              className="field"
              aria-label="事实与推断"
              value={draft.basis}
              onChange={(e) => patch({ basis: e.target.value as Finding['basis'] })}
            >
              {Object.entries(basisNames).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          父节点 / 归属关系
          <select
            className="field"
            aria-label="父节点关系"
            value={draft.parentId ?? ''}
            onChange={(e) => patch({ parentId: e.target.value || null })}
          >
            <option value="">直接归属产品目标</option>
            {p.findings
              .filter((f) => f.id !== draft.id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {findingKindNames[f.kind]} · {f.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          推断或判断依据
          <textarea
            className="field"
            aria-label="推断依据"
            rows={2}
            maxLength={3000}
            value={draft.rationale ?? ''}
            onChange={(e) => patch({ rationale: e.target.value })}
          />
        </label>
        <label>
          不确定性 / 待核实内容
          <textarea
            className="field"
            aria-label="不确定性说明"
            rows={2}
            maxLength={2000}
            value={draft.uncertainty ?? ''}
            onChange={(e) => patch({ uncertainty: e.target.value })}
          />
        </label>
        <label>
          用户行为
          <textarea
            className="field"
            rows={2}
            maxLength={2000}
            value={draft.behavior}
            onChange={(e) => patch({ behavior: e.target.value })}
          />
        </label>
        <label>
          预期结果
          <textarea
            className="field"
            rows={2}
            maxLength={2000}
            value={draft.outcome}
            onChange={(e) => patch({ outcome: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            优先级
            <select
              className="field"
              aria-label="功能优先级"
              value={draft.priority}
              onChange={(e) => patch({ priority: e.target.value as Finding['priority'] })}
            >
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <label>
            实施阶段
            <select
              className="field"
              value={draft.phase}
              onChange={(e) => patch({ phase: e.target.value as Finding['phase'] })}
            >
              <option value="mvp">第一阶段</option>
              <option value="next">下一阶段</option>
              <option value="later">后续考虑</option>
            </select>
          </label>
        </div>
        <fieldset className="evidence-checklist">
          <legend>支持证据（可以多选）</legend>
          {p.evidence
            .filter((e) => evidenceValid(p, e) || draft.evidenceIds.includes(e.evidenceId))
            .map((e) => (
              <label key={e.evidenceId}>
                <input
                  type="checkbox"
                  checked={draft.evidenceIds.includes(e.evidenceId)}
                  onChange={(event) =>
                    patch({
                      evidenceIds: event.target.checked
                        ? [...draft.evidenceIds, e.evidenceId]
                        : draft.evidenceIds.filter((id) => id !== e.evidenceId),
                    })
                  }
                />
                {e.title}
                {!evidenceValid(p, e) && ' · 已失效'}
              </label>
            ))}
        </fieldset>
        <Button type="submit">保存结论，等待确认</Button>
      </form>
    </Modal>
  );
}
export function OverviewPanel({ project: p, update }: Pick<Props, 'project' | 'update'>) {
  const original = useRef<Exploration | null>(null);
  const fields = {
    goal: '产品目标',
    problem: '解决什么问题',
    users: '面向用户',
    outcome: '期望结果',
    constraints: '已明确的限制',
  } as const;
  return (
    <section className="explore-overview">
      <div className="explore-section-heading">
        <div>
          <h2>产品概览</h2>
          <p>未提供的信息保持空白；推断与事实分别核对。</p>
        </div>
        <span className={`finding-status ${p.overviewConfirmed ? 'confirmed' : 'pending'}`}>
          {p.overviewConfirmed ? '已确认' : '待人工确认'}
        </span>
      </div>
      {Object.entries(fields).map(([field, label]) => {
        const key = field as keyof typeof fields;
        return (
          <label key={field}>
            {label}
            {p.overview.inferredFields.includes(key) && <small> AI推断，待核实</small>}
            <textarea
              className="field"
              aria-label={label}
              value={p.overview[key]}
              rows={key === 'goal' || key === 'constraints' ? 4 : 3}
              maxLength={key === 'users' || key === 'outcome' ? 2000 : 3000}
              placeholder="未明确，待补充"
              onFocus={() => {
                original.current = structuredClone(p);
              }}
              onBlur={() => {
                const before = original.current;
                original.current = null;
                if (before)
                  update((current) =>
                    recordResearchChange(before, current, `人工编辑产品概览：${label}`),
                  );
              }}
              onChange={(event) =>
                update((current) => {
                  const n = structuredClone(current);
                  n.overview[key] = event.target.value;
                  n.overviewRevision++;
                  n.overviewConfirmed = false;
                  return touchExploration(n);
                })
              }
            />
          </label>
        );
      })}
      <Button
        onClick={() =>
          update((current) => {
            if (!current.overview.goal.trim()) throw new Error('请先明确产品目标。');
            if (
              current.overview.evidenceIds.some(
                (id) =>
                  !current.evidence.some((e) => e.evidenceId === id && evidenceValid(current, e)),
              )
            )
              throw new Error('概览证据已失效，请重新分析或在原资料中核实。');
            const n = structuredClone(current);
            n.overviewConfirmed = true;
            n.overviewRevision++;
            return touchExploration(n, '人工确认产品概览');
          })
        }
      >
        <Check size={16} />
        确认产品概览
      </Button>
    </section>
  );
}
export function QuestionPanel({
  project: p,
  update,
  jumpEvidence,
}: Pick<Props, 'project' | 'update' | 'jumpEvidence'>) {
  return (
    <section className="explore-questions">
      <h2>待确认问题</h2>
      <p className="muted">与需求实验室共用同一决定；回答不代替需求或岗位确认。</p>
      {!p.questions.length && (
        <div className="explore-empty">
          暂无问题记录。可以先分析资料，或在产品概览补充当前未知项。
        </div>
      )}
      {currentDecisions(p.questions).map((q) => (
        <article key={q.id} className="explore-question-card">
          <h3>{q.title}</h3>
          <p>{q.detail}</p>
          <div className="finding-evidence-links">
            {q.evidenceIds.map((id) => (
              <button key={id} onClick={() => jumpEvidence(id)}>
                查看对应证据
              </button>
            ))}
          </div>
          <ResearchDecision project={p} question={q} update={update} />
          <p>当前记录：{decisionAnswer(q)}</p>
        </article>
      ))}
    </section>
  );
}
export function StructurePanel({ project: p, select, update, jumpEvidence }: Props) {
  const [editing, setEditing] = useState<Finding | null>(null);
  function branch(parentId: string | null, seen: Set<string>): React.ReactNode {
    if (seen.size > 8) return <li>更深层级请在功能清单查看</li>;
    return p.findings
      .filter((f) => f.parentId === parentId && !seen.has(f.id))
      .map((f) => (
        <li key={f.id} id={`finding-${f.id}`} className={f.status === 'excluded' ? 'excluded' : ''}>
          <button onClick={() => select(f.id)}>
            <span>{findingKindNames[f.kind]}</span>
            <strong>{f.title}</strong>
            <small>
              {statuses[f.status]} · {basisNames[f.basis]}
            </small>
            <small>
              {
                new Set(
                  f.evidenceIds
                    .map((id) => p.evidence.find((e) => e.evidenceId === id)?.sourceId)
                    .filter(Boolean),
                ).size
              }
              份来源 · {f.evidenceIds.length}条证据
            </small>
          </button>
          <div className="structure-node-actions">
            <button disabled={f.locked} onClick={() => setEditing(structuredClone(f))}>
              编辑节点
            </button>
            <button
              disabled={f.locked}
              onClick={() =>
                update((current) => changeFinding(current, f.id, { status: 'pending' }))
              }
            >
              标记待确认
            </button>
            <button
              disabled={f.locked}
              onClick={() =>
                update((current) =>
                  changeFinding(current, f.id, {
                    status: f.status === 'excluded' ? 'pending' : 'excluded',
                  }),
                )
              }
            >
              {f.status === 'excluded' ? '恢复节点' : '排除节点'}
            </button>
            {f.evidenceIds[0] && (
              <button
                onClick={() => {
                  select(f.id);
                  jumpEvidence(f.evidenceIds[0]);
                }}
              >
                定位证据
              </button>
            )}
          </div>
          <ul>{branch(f.id, new Set([...seen, f.id]))}</ul>
          {p.questions
            .filter((q) => q.findingIds.includes(f.id))
            .map((q) => (
              <div className="structure-question" key={q.id}>
                待确认问题：{q.title} · {q.status === 'answered' ? '已回答' : '仍需处理'}
              </div>
            ))}
        </li>
      ));
  }
  return (
    <section className="explore-structure">
      <h2>需求结构图</h2>
      <Button
        variant="outline"
        onClick={() =>
          setEditing({
            id: makeId(),
            revision: 1,
            kind: 'scenario',
            title: '',
            description: '',
            behavior: '',
            outcome: '',
            basis: 'inferred',
            priority: 'medium',
            phase: 'mvp',
            status: 'pending',
            locked: false,
            evidenceIds: [],
            parentId:
              p.ui.findingId && p.findings.some((f) => f.id === p.ui.findingId)
                ? p.ui.findingId
                : null,
            origin: 'user',
          })
        }
      >
        添加结构节点
      </Button>
      <p className="muted">
        层级来自资料整理与人工结论。点击节点查看需求；没有关联依据时平级展示。
      </p>
      <div className="structure-root">
        <CompassLabel />
        {p.overview.goal || p.title}
      </div>
      <ul className="structure-tree">{branch(null, new Set())}</ul>
      {editing && (
        <FindingEditor
          project={p}
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            const ok = update((current) => {
              const old = current.findings.find((f) => f.id === draft.id);
              if (old) {
                if (old.revision !== editing.revision)
                  throw new Error('节点已有新编辑，请重新打开。');
                return changeFinding(current, old.id, {
                  title: draft.title,
                  description: draft.description,
                  kind: draft.kind,
                  basis: draft.basis,
                  parentId: draft.parentId,
                  evidenceIds: draft.evidenceIds,
                  behavior: draft.behavior,
                  outcome: draft.outcome,
                  priority: draft.priority,
                  phase: draft.phase,
                  rationale: draft.rationale,
                  uncertainty: draft.uncertainty,
                });
              }
              if (draft.parentId && !current.findings.some((f) => f.id === draft.parentId))
                throw new Error('父节点不存在。');
              const n = structuredClone(current);
              n.findings.push(draft);
              return touchExploration(n, '人工添加需求结构节点');
            });
            if (ok) setEditing(null);
          }}
        />
      )}
    </section>
  );
}
function CompassLabel() {
  return <span>产品目标</span>;
}
