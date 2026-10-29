'use client';
import { useState } from 'react';
import { BriefcaseBusiness, Focus, Lock, Unlock, ChevronDown, ChevronRight } from 'lucide-react';
import { chooseSolutions, editSolution, editRequirement } from '@/lib/lab/operations';
import { requirementTypeNames } from '@/lib/lab/model';
import type { Exploration } from '@/lib/exploration/model';
import { ChainDetails } from './chain-details';
type Props = {
  project: Exploration;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  onFocus: (id: string) => void;
  onEdit: (id: string) => void;
  onImport: () => void;
  readonly?: boolean;
  guided?: boolean;
  onSource?: (id: string, evidenceId?: string) => void;
  onEdge?: (id: string) => void;
};
export function RolePanel({
  project: p,
  update,
  onFocus,
  onEdit,
  onImport,
  readonly = false,
  guided = false,
  onSource,
  onEdge,
}: Props) {
  const lab = p.lab!;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const chosen = lab.activeSolutionIds;
  return (
    <aside className="lab-role-panel" aria-label="候选岗位方案与要求">
      <header>
        <BriefcaseBusiness size={20} />
        <div>
          <h2>把需求，落到角色</h2>
          <p>方案可组合，要求逐条确认</p>
        </div>
      </header>
      {!lab.solutions.length && (
        <div className="lab-panel-empty">
          <p>完成关联分析后，将在这里看到有依据、有假设的候选岗位方案。</p>
          <small>模型不能从截图确定准确人数或技术栈。</small>
        </div>
      )}
      {!guided && <ChainDetails project={p} onSource={onSource} onEdge={onEdge} />}
      {lab.solutions.slice(0, guided && !showAll ? 2 : lab.solutions.length).map((s) => (
        <article
          key={s.id}
          className={`lab-solution ${chosen.includes(s.id) ? 'chosen' : ''}`}
          data-testid={guided ? 'guided-role-solution' : 'role-solution'}
        >
          <div className="lab-solution-heading">
            <label>
              <input
                type="checkbox"
                data-tour="lab-select-plan"
                disabled={readonly || s.status === 'excluded'}
                checked={chosen.includes(s.id)}
                onChange={(e) =>
                  update((n) =>
                    chooseSolutions(
                      n,
                      e.target.checked ? [...chosen, s.id] : chosen.filter((id) => id !== s.id),
                    ),
                  )
                }
              />
              <strong>{s.title}</strong>
            </label>
            <span className={`lab-status ${s.status}`}>
              {
                {
                  pending: '待确认',
                  confirmed: '已确认',
                  excluded: '已排除',
                  review: '需复核',
                  stale: '过期',
                }[s.status]
              }
            </span>
          </div>
          <p>{s.description}</p>
          <small>
            {s.roles
              .map(
                (r) =>
                  `${r.title} · ${r.headcount === null ? '人数待确认' : `${r.headcount}人（条件方案）`}`,
              )
              .join('；')}
          </small>
          <button
            className="lab-text-button"
            aria-expanded={expanded === s.id}
            onClick={() => setExpanded(expanded === s.id ? null : s.id)}
          >
            {expanded === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            依据、假设与取舍
          </button>
          {expanded === s.id && (
            <div className="lab-solution-reason">
              <p>依据：{s.rationale}</p>
              {[
                ['成立条件', s.assumptions],
                ['优势', s.advantages],
                ['代价', s.disadvantages],
                ['待确认', s.openQuestions],
              ].map(([title, values]) => (
                <div key={String(title)}>
                  <strong>{title}</strong>
                  <ul>
                    {(values as string[]).map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {!readonly && (
            <div className="explore-inline-actions">
              <button
                disabled={s.status === 'confirmed'}
                data-tour="lab-confirm-solution"
                onClick={() => update((n) => editSolution(n, s.id, { status: 'confirmed' }))}
              >
                确认方案
              </button>
              <button onClick={() => onEdit(`role:${s.id}:${s.roles[0].key}`)}>修改</button>
              <button
                disabled={s.status === 'excluded'}
                onClick={() => update((n) => editSolution(n, s.id, { status: 'excluded' }))}
              >
                排除
              </button>
            </div>
          )}
        </article>
      ))}
      {guided && lab.solutions.length > 2 && (
        <button className="guided-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? '收起次要方案' : `展开其余${lab.solutions.length - 2}个方案`}
        </button>
      )}
      <h3 className="lab-requirements-heading">
        当前方案 · 逐条岗位要求{' '}
        <small>
          {
            lab.requirements.filter((r) => chosen.includes(r.solutionId) && r.status !== 'excluded')
              .length
          }
          项
        </small>
      </h3>
      {!chosen.length && (
        <p className="lab-panel-empty">选择一个或多个方案，查看对应要求与证据链。</p>
      )}
      {lab.requirements
        .filter((r) => chosen.includes(r.solutionId) && r.status !== 'excluded')
        .map((r) => {
          const direct = r.evidenceIds.length > 0,
            conflict = lab.edges.some(
              (e) =>
                e.relationType === 'conflicts_with' &&
                e.status !== 'deleted' &&
                e.evidenceRefs.some((id) => r.evidenceIds.includes(id)),
            );
          return (
            <article
              key={r.id}
              className={`lab-role-requirement ${lab.ui.focusedRequirementId === r.id ? 'focused' : ''}`}
              data-testid={guided ? 'guided-role-requirement' : 'role-requirement'}
            >
              <button className="lab-requirement-title" onClick={() => onFocus(r.id)}>
                <Focus size={15} />
                <strong>{r.title}</strong>
              </button>
              <p>{r.description}</p>
              <div className="lab-requirement-tags">
                <span>{requirementTypeNames[r.requirementType]}</span>
                <span>
                  {r.status === 'confirmed'
                    ? '已确认'
                    : r.status === 'review'
                      ? '需复核'
                      : '待确认'}
                </span>
                {r.locked && <Lock size={12} />}
              </div>
              <small>
                {conflict
                  ? '存在冲突，须核对双方依据'
                  : direct
                    ? '有资料依据；岗位要求仍是AI建议'
                    : r.inferenceIds.length
                      ? '推断支持，条件待确认'
                      : '证据不足，待确认'}
              </small>
              {!readonly && (
                <div className="explore-inline-actions">
                  <button
                    disabled={r.locked || r.status === 'confirmed'}
                    data-tour="lab-confirm-requirement"
                    onClick={() => update((n) => editRequirement(n, r.id, { status: 'confirmed' }))}
                  >
                    确认要求
                  </button>
                  <button onClick={() => onEdit(`requirement:${r.id}`)}>编辑</button>
                  <button
                    aria-label={r.locked ? '解锁岗位要求' : '锁定岗位要求'}
                    onClick={() => update((n) => editRequirement(n, r.id, { locked: !r.locked }))}
                  >
                    {r.locked ? <Unlock size={13} /> : <Lock size={13} />}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      {!readonly && !guided && (
        <div className="lab-role-panel-footer">
          <button
            className="lab-primary"
            disabled={
              !chosen.length ||
              !lab.solutions.some((s) => chosen.includes(s.id) && s.status === 'confirmed')
            }
            onClick={onImport}
          >
            预览并导入岗位工作台 →
          </button>
          <small>仅导入确认过的方案与所选要求。工作台内全部重新待确认。</small>
        </div>
      )}
    </aside>
  );
}
