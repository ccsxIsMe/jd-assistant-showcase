'use client';
import { useState } from 'react';
import { Check, GitMerge, Network, ChevronDown, FilePenLine } from 'lucide-react';
import { researchProgress } from '@/lib/lab/guided';
import { editFindingNode, editResearchGoal, mergeFeatureCandidates } from '@/lib/lab/operations';
import { DecisionReferences } from '../decisions/decision-references';
import { currentDecisions } from '@/lib/decisions/records';
import { Modal } from '../workbench/modal';
import type { GuidedActions } from './guided-types';
export function GuidedRequirements(a: GuidedActions) {
  const p = a.project,
    { features } = researchProgress(p);
  const [goalDraft, setGoal] = useState<string | null>(null),
    [all, setAll] = useState(false),
    [merge, setMerge] = useState<string | null>(null),
    [from, setFrom] = useState('');
  const goal = goalDraft ?? (p.overview.goal || p.initialObjective || '');
  const sorted = [...features].sort(
    (a, b) =>
      ({ high: 0, medium: 1, low: 2 })[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority],
  );
  const other = p.findings.filter((f) => f.kind !== 'feature' && f.status !== 'excluded');
  return (
    <div>
      <section className="guided-goal">
        <div>
          <span className="guided-kicker">产品目标</span>
          <h2>把参考能力，变成你自己的选择。</h2>
          <p>资料展示的能力仍是候选；确认后才代表你接受这个产品范围。</p>
        </div>
        <p>已沿用当前目标：{goal || '尚未明确，可保留未知。'}</p>
        <details>
          <summary>修改当前产品目标</summary>
          <label>
            当前产品目标
            <textarea
              aria-label="引导产品目标"
              value={goal}
              maxLength={3000}
              rows={3}
              readOnly={a.readonly}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          {!a.readonly && (
            <button
              disabled={!goal.trim()}
              onClick={() => a.update((p) => editResearchGoal(p, goal))}
            >
              保存产品目标
            </button>
          )}
        </details>
      </section>
      <section className="guided-section">
        <div className="guided-section-heading">
          <div>
            <h2>
              核心功能 <small>{features.length}项</small>
            </h2>
            <p>先看主要功能，修改只影响关联对象，不重新改写全部研究。</p>
          </div>
          {!a.readonly && (
            <button
              disabled={a.busy || !p.evidence.length}
              onClick={() => a.onAnalyze('derive_features')}
            >
              {features.length ? '按当前资料补充候选' : '整理产品需求'}
            </button>
          )}
        </div>
        {!features.length && (
          <div className="guided-empty">
            <FilePenLine size={27} />
            <p>资料已保留。点击“整理产品需求”，得到可编辑、可确认的候选功能。</p>
          </div>
        )}
        <div className="guided-feature-grid">
          {sorted.slice(0, all ? sorted.length : 6).map((f) => {
            const qs = currentDecisions(p.questions).filter(
              (q) => q.findingIds.includes(f.id) && ['open', 'deferred'].includes(q.status),
            );
            return (
              <article className="guided-feature" key={f.id} data-testid="guided-feature">
                <div className="guided-inline">
                  <span className="guided-badge">
                    {
                      {
                        pending: '候选功能',
                        confirmed: '用户已确认',
                        review: '需要复核',
                        excluded: '已排除',
                      }[f.status]
                    }
                  </span>
                  <small>
                    {f.basis === 'inferred'
                      ? 'AI推断'
                      : f.basis === 'observed'
                        ? '参考资料展示'
                        : '用户提供的需求'}
                  </small>
                </div>
                <h3>{f.title}</h3>
                <p>{f.description}</p>
                <div className="guided-meta">
                  <span>{f.evidenceIds.length}条关键证据</span>
                  <span>{qs.length ? `${qs.length}个相关问题` : '暂无关联问题'}</span>
                </div>
                <div className="guided-inline">
                  <button onClick={() => a.onFocus(`finding:${f.id}`)}>
                    <Network size={14} />
                    查看证据链
                  </button>
                  <button onClick={() => a.onEdit(`finding:${f.id}`)}>编辑与排除</button>
                  {!a.readonly && (
                    <>
                      <button
                        disabled={f.locked || f.status === 'confirmed'}
                        onClick={() =>
                          a.update((p) => editFindingNode(p, f.id, { status: 'confirmed' }))
                        }
                      >
                        <Check size={14} />
                        确认功能
                      </button>
                      <button
                        disabled={f.locked || features.length < 2}
                        onClick={() => {
                          setMerge(f.id);
                          setFrom('');
                        }}
                      >
                        <GitMerge size={14} />
                        合并
                      </button>
                    </>
                  )}
                </div>
                {f.basis === 'inferred' && (
                  <small className="guided-warning">
                    推断不会因用户接受而变成来源原话。{f.uncertainty}
                  </small>
                )}
              </article>
            );
          })}
        </div>
        {features.length > 6 && (
          <button className="guided-more" onClick={() => setAll(!all)}>
            <ChevronDown size={14} />
            {all ? '收起次要功能' : `展开另外${features.length - 6}项功能`}
          </button>
        )}
      </section>
      <section className="guided-section">
        <h2>约束、依赖与不确定性</h2>
        <p>{p.overview.constraints || '预算、交付时间和团队能力尚未明确，可保留为方案假设。'}</p>
        <details>
          <summary>{other.length}项补充结论与推断</summary>
          {other.map((f) => (
            <article className="guided-compact-card" key={f.id}>
              <strong>{f.title}</strong>
              <span className="guided-badge">
                {f.basis === 'inferred'
                  ? 'AI推断，非原始事实'
                  : f.kind === 'conflict'
                    ? '冲突待核实'
                    : '资料候选'}
              </span>
              <p>{f.description}</p>
              <button onClick={() => a.onEdit(`finding:${f.id}`)}>查看依据与处理</button>
            </article>
          ))}
        </details>
      </section>
      <section className="guided-section">
        <h2>带到后续方案的问题</h2>
        <DecisionReferences project={p} onAnswer={a.onAnswer} readonly={a.readonly} />
      </section>
      {merge && (
        <Modal title="合并重复功能" onClose={() => setMerge(null)}>
          <div className="form-stack">
            <p>
              合并到「{features.find((f) => f.id === merge)?.title}
              」。两项原始证据保留，被合并项标记排除；若来源属性不同，结果按推断处理并待复核。相关岗位要求需复核，可撤销。
            </p>
            <label>
              选择要合并的功能
              <select
                aria-label="被合并功能"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="">请选择</option>
                {features
                  .filter((f) => f.id !== merge && !f.locked)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="lab-primary"
              disabled={!from}
              onClick={() => {
                if (a.update((p) => mergeFeatureCandidates(p, merge, from))) setMerge(null);
              }}
            >
              确认合并并保留来源
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
