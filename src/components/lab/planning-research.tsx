'use client';
import { useState } from 'react';
import { Sparkles, ArrowRight, ChevronDown } from 'lucide-react';
import type { GuidedActions } from './guided-types';
import { GuidedMaterials } from './guided-materials';
import { GuidedEvidence } from './guided-evidence';
import { GuidedHandoff } from './guided-handoff';
import { ResearchDecision } from '../decisions/repairable-decision';
import { decisionSettled, inspectDecision } from '@/lib/decisions/quality';
import { choosePlanningSolution, confirmPlanningPackage } from '@/lib/lab/operations';
import { orderedQuestions, researchProgress } from '@/lib/lab/guided';
import {
  criticalPlanningItems,
  conflictSignature,
  packageSignature,
  planningTasks,
  planningConstraintText,
  readPlanningConstraints,
} from '@/lib/lab/planning';
import { stageNames, requirementTypeNames } from '@/lib/lab/model';
import { touchExploration } from '@/lib/exploration/domain';
export type PlanningInput = {
  goal: string;
  budget: string;
  deadline: string;
  constraints: string;
  expectedRevision?: number;
};
export function PlanningResearch(
  a: GuidedActions & {
    hidden: boolean;
    onStart: (input: PlanningInput) => Promise<number | undefined>;
    onContinue: () => void;
    onScreen: (screen: 'input' | 'results' | 'handoff') => void;
    onCollaborate: () => void;
    onPreference: (text: string) => void;
  },
) {
  const p = a.project,
    lab = p.lab!,
    screen = lab.ui.planningScreen;
  const idea = p.sources.find(
    (s) => !s.removed && s.kind === 'text' && s.versions[0].text === p.initialObjective,
  );
  const [goalDraft, setGoal] = useState<string | null>(null),
    [expected, setExpected] = useState<number | undefined>(),
    [budget, setBudget] = useState(readPlanningConstraints(p).budget),
    [deadline, setDeadline] = useState(readPlanningConstraints(p).deadline),
    [constraints, setConstraints] = useState(readPlanningConstraints(p).constraints),
    [more, setMore] = useState(false),
    [custom, setCustom] = useState(''),
    [ack, setAck] = useState<string | null>(null),
    [selection, setSelection] = useState<string[] | null>(null);
  const goal = goalDraft ?? idea?.versions.at(-1)?.text ?? p.initialObjective ?? '';
  const plans = lab.solutions.filter((s) => s.status !== 'excluded' && s.status !== 'stale'),
    chosen = lab.activeSolutionIds;
  const requirements = lab.requirements.filter(
    (r) => chosen.includes(r.solutionId) && r.status !== 'excluded',
  );
  const picked = (selection ?? requirements.map((r) => r.id)).filter((id) =>
    requirements.some((r) => r.id === id),
  );
  const noHire =
    chosen.length > 0 &&
    plans.filter((s) => chosen.includes(s.id)).every((s) => s.hiringNeed === 'not-needed');
  const questions = orderedQuestions(p),
    critical = criticalPlanningItems(p),
    last = lab.runs.at(-1),
    todo = planningTasks(p);
  const activeQuestions = questions.filter((q) => !decisionSettled(q)),
    otherQuestions = questions.filter((q) => decisionSettled(q)).concat(activeQuestions.slice(3));
  const ready =
    lab.researchGuide.packageSignature === packageSignature(p) &&
    !!lab.researchGuide.packageSignature;
  return (
    <main className="planning-research" hidden={a.hidden} aria-label="AI帮我规划">
      <header className="planning-heading">
        <div>
          <span className="guided-kicker">AI帮我规划 · 由你做决定</span>
          <span className={`planning-analysis-mode ${p.mode}`}>
            {p.mode === 'real' ? '真实DeepSeek · 发送前确认' : '演示/本地规则 · 不是本次真实AI分析'}
          </span>
          {!a.readonly && (
            <button
              className="planning-mode-switch"
              disabled={a.busy}
              onClick={() =>
                a.update((current) =>
                  touchExploration({
                    ...current,
                    mode: current.mode === 'real' ? 'example' : 'real',
                  }),
                )
              }
            >
              {p.mode === 'real' ? '改用演示模式' : '切换为真实AI'}
            </button>
          )}
          <h1>
            {screen === 'input'
              ? '把想法交给我们，从这里开始。'
              : screen === 'handoff'
                ? '把决定带进下一步共创。'
                : '先看方向，再决定做什么。'}
          </h1>
          <p>不必预先知道技术栈或岗位名称。分析是候选，确认与保存由你决定。</p>
        </div>
      </header>
      {a.busy && (
        <div role="status" className="planning-processing">
          <Sparkles size={18} />
          {last ? stageNames[last.stage] : '准备当前资料'} · 正在实际处理，已完成内容会保留
        </div>
      )}
      {last && ['failed', 'cancelled', 'stale', 'partial'].includes(last.status) && (
        <div className="planning-recovery">
          <strong>
            {stageNames[last.stage]} ·{' '}
            {
              { failed: '失败', cancelled: '已取消', stale: '结果过期', partial: '部分完成' }[
                last.status as 'failed'
              ]
            }
          </strong>
          <p>{last.errorMessage}</p>
          <button disabled={a.busy} onClick={a.onContinue}>
            继续未完成的规划
          </button>
          <button onClick={() => a.onScreen('input')}>修改资料</button>
        </div>
      )}
      {screen === 'input' && (
        <>
          <section className="planning-input">
            <label>
              想实现什么？（或先添加一份有效资料）
              <textarea
                data-tour="lab-goal"
                aria-label="规划产品目标"
                value={goal}
                maxLength={3000}
                rows={5}
                onChange={(e) => {
                  if (goalDraft === null) setExpected(idea?.versions.at(-1)?.revision);
                  setGoal(e.target.value);
                }}
                placeholder="我想做一个在线设计工具，希望一起编辑并导出成果，还不知道首版要做多少功能。"
                readOnly={a.readonly}
              />
            </label>
            <details>
              <summary>预算与交付时间（可选）</summary>
              <div className="planning-constraints">
                <label>
                  预算（可选）
                  <input
                    aria-label="规划预算"
                    maxLength={500}
                    value={budget}
                    readOnly={a.readonly}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="不知道可留空"
                  />
                </label>
                <label>
                  交付时间（可选）
                  <input
                    aria-label="规划交付时间"
                    maxLength={500}
                    value={deadline}
                    readOnly={a.readonly}
                    onChange={(e) => setDeadline(e.target.value)}
                    placeholder="不知道可留空"
                  />
                </label>
              </div>
            </details>
            <details>
              <summary>其他约束或补充</summary>
              <label>
                其他约束
                <textarea
                  aria-label="规划其他约束"
                  maxLength={2000}
                  value={constraints}
                  readOnly={a.readonly}
                  onChange={(e) => setConstraints(e.target.value)}
                />
              </label>
            </details>
            <p>只需一句产品目标，或一份可分析的资料。图片和视频的可用范围会在资料中明确说明。</p>
            <button
              data-tour="lab-plan-start"
              className="lab-primary"
              disabled={a.busy || a.readonly}
              onClick={() => {
                const submitted = {
                  goal,
                  budget,
                  deadline,
                  constraints,
                  expectedRevision: goalDraft === null ? idea?.versions.at(-1)?.revision : expected,
                };
                void a.onStart(submitted).then((revision) => {
                  if (revision !== undefined) {
                    setExpected(revision);
                    setGoal((current) => (current === submitted.goal ? null : current));
                  }
                });
              }}
            >
              <Sparkles size={16} />
              {plans.length ? '按当前输入继续规划' : '开始AI规划'}
            </button>
            {plans.length > 0 && (
              <button onClick={() => a.onScreen('results')}>继续查看已有结果</button>
            )}
          </section>
          <details
            className="planning-materials"
            open={
              !p.sources.some((s) => !s.removed) ||
              p.sources.some((s) => !s.removed && s.status === 'error')
            }
          >
            <summary>
              参考网址、图片与文件 · {p.sources.filter((s) => !s.removed).length}份资料
              {p.sources.some((s) => !s.removed && s.status === 'error') &&
                ' · 有资料解析失败，请展开处理'}
            </summary>
            <GuidedMaterials {...a} hideIdea />
          </details>
        </>
      )}
      {screen === 'results' && (
        <>
          <section className="planning-summary">
            <div>
              <span className="guided-kicker">当前目标</span>
              <h2>{p.overview.goal || p.initialObjective || '目标尚未明确，按资料形成候选'}</h2>
              <p>
                {planningConstraintText(p) ||
                  p.overview.constraints ||
                  '预算、交付时间和资源尚未明确，继续保留为未知。'}
              </p>
            </div>
            <button onClick={() => a.onScreen('input')}>修改我的偏好与资料</button>
          </section>
          <details className="planning-proof">
            <summary>
              关键证据与重要冲突 · {researchProgress(p).evidence.length}条可核对证据
            </summary>
            <GuidedEvidence {...a} />
          </details>
          {critical.length > 0 && (
            <section className="planning-critical">
              <h2>这些条件仍需保留</h2>
              {critical.slice(0, 3).map((c) => (
                <p key={c.id}>{c.text}</p>
              ))}
              {critical.length > 3 && (
                <details>
                  <summary>其余{critical.length - 3}项</summary>
                  {critical.slice(3).map((c) => (
                    <p key={c.id}>{c.text}</p>
                  ))}
                </details>
              )}
              <small>可以先比较方案；生成资料包前请处理，或明确接受带着当前假设继续。</small>
            </section>
          )}
          <div className="guided-section-heading">
            <div>
              <h2>选择适合当前阶段的方向</h2>
              <p>方案是带条件的建议，选择不会自动确认功能或招聘人数。</p>
            </div>
            <button disabled={a.busy} onClick={a.onContinue}>
              {todo.length ? '继续有效的未完成分析' : '查看已有方案'}
            </button>
          </div>
          <section className="planning-plan-grid" data-tour="lab-plan-options">
            {plans.slice(0, more ? plans.length : 3).map((s) => {
              const pp = s.productPlan,
                priority = pp?.priorityFeatureIds.length
                  ? pp.priorityFeatureIds
                  : s.relatedFeatureIds;
              return (
                <article
                  key={s.id}
                  data-testid="planning-solution"
                  className={chosen.includes(s.id) ? 'selected' : ''}
                >
                  <span className="guided-badge">
                    {s.status === 'confirmed' ? '人工已确认' : 'AI候选 · 待确认'}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.description}</p>
                  <p>
                    <strong>目标：</strong>
                    {pp?.goal || p.overview.goal || '目标待明确'}
                  </p>
                  <h4>优先范围</h4>
                  <ul>
                    {p.findings
                      .filter((f) => priority.includes(f.id))
                      .slice(0, 5)
                      .map((f) => (
                        <li key={f.id}>{f.title}</li>
                      ))}
                  </ul>
                  <p>
                    <strong>主要差异：</strong>
                    {pp?.difference || s.rationale}
                  </p>
                  <section className="planning-capabilities" aria-label="这项方案需要的具体能力">
                    <h4>建议具备的能力 · 待你确认</h4>
                    {lab.requirements
                      .filter((r) => r.solutionId === s.id && r.status !== 'excluded')
                      .slice(0, 5)
                      .map((r) => (
                        <div key={r.id}>
                          <span className="guided-badge">
                            {requirementTypeNames[r.requirementType]}
                          </span>
                          <strong>{r.title}</strong>
                          <p>{r.description}</p>
                        </div>
                      ))}
                    {!lab.requirements.some((r) => r.solutionId === s.id) && (
                      <p>
                        {s.hiringNeed === 'not-needed'
                          ? '当前方向不建议新增招聘，先核对现有服务是否满足需求。'
                          : '尚无可靠能力候选，保留未知，不凑出通用技能清单。'}
                      </p>
                    )}
                    <small>
                      这些是基于工作内容的能力建议；工具选型和必要性尚需你确认，不代表资料已经写明。
                    </small>
                  </section>
                  <p>
                    <strong>复杂度：</strong>
                    {pp?.complexity || '需结合范围、团队和资源核实，暂不估算工期'}
                  </p>
                  <p>
                    <strong>关键假设：</strong>
                    {s.assumptions.slice(0, 2).join('；')}
                  </p>
                  <p>
                    <strong>风险：</strong>
                    {s.disadvantages.slice(0, 2).join('；')}
                  </p>
                  <details>
                    <summary>比较依据、取舍与候选岗位</summary>
                    <p>{s.rationale}</p>
                    <h4>暂缓的功能</h4>
                    <ul>
                      {p.findings
                        .filter((f) => pp?.deferredFeatureIds.includes(f.id))
                        .map((f) => (
                          <li key={f.id}>{f.title}</li>
                        ))}
                    </ul>
                    <h4>优点</h4>
                    <p>{s.advantages.join('；')}</p>
                    <h4>适用条件与待确认项</h4>
                    <p>{s.openQuestions.join('；')}</p>
                    <h4>可能涉及的能力（推断）</h4>
                    <p>
                      {pp?.capabilityNotes.join('；') || '根据实际范围再决定能力，不预设技术栈'}
                    </p>
                    <h4>候选岗位</h4>
                    {s.roles.map((r) => (
                      <p key={r.key}>
                        {r.title} ·{' '}
                        {r.headcount === null ? '人数待确认' : `${r.headcount}人（条件建议）`}
                      </p>
                    ))}
                  </details>
                  <div className="planning-plan-actions">
                    <button
                      data-tour="lab-select-plan"
                      disabled={a.readonly}
                      aria-pressed={chosen.includes(s.id)}
                      onClick={() => {
                        setSelection(null);
                        a.update((n) => choosePlanningSolution(n, [s.id], 'selected'));
                      }}
                    >
                      选择此方案
                    </button>
                    <label>
                      <input
                        aria-label={`组合方案${s.title}`}
                        type="checkbox"
                        disabled={a.readonly}
                        checked={chosen.includes(s.id)}
                        onChange={(e) => {
                          setSelection(null);
                          const ids = e.target.checked
                            ? [...chosen, s.id]
                            : chosen.filter((id) => id !== s.id);
                          a.update((n) =>
                            choosePlanningSolution(n, ids, ids.length ? 'selected' : 'none'),
                          );
                        }}
                      />
                      与其他方案组合
                    </label>
                    <button onClick={() => a.onFocus(`role:${s.id}:${s.roles[0].key}`)}>
                      查看证据
                    </button>
                  </div>
                </article>
              );
            })}
            {!plans.length && (
              <p className="guided-empty">
                还没有可比较的方案。已成功阶段保留；可以继续规划，或补充目标与可核对资料。资料不足时不会凑足方案数量。
              </p>
            )}
          </section>
          {plans.length > 3 && (
            <button onClick={() => setMore(!more)}>
              <ChevronDown size={15} />
              {more ? '收起其他方案' : '展开更多方案'}
            </button>
          )}
          <fieldset className="planning-own-direction">
            <legend>{plans.length ? '没有合适的方向？' : '补充规划偏好（可选）'}</legend>
            <details>
              <summary>填写自己的方向（可选）</summary>
              <label>
                自己的偏好
                <textarea
                  aria-label="自己的规划偏好"
                  readOnly={a.readonly}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  maxLength={3000}
                />
              </label>
              <button
                disabled={a.readonly}
                onClick={() => {
                  a.onPreference(custom);
                }}
              >
                其他，请填写并保存
              </button>
            </details>
            {plans.length > 0 && (
              <button
                disabled={a.readonly}
                onClick={() => a.update((n) => choosePlanningSolution(n, [], 'uncertain'))}
              >
                我不确定
              </button>
            )}
            {plans.length > 0 && (
              <button
                disabled={a.readonly}
                onClick={() => a.update((n) => choosePlanningSolution(n, [], 'none'))}
              >
                以上都不适用
              </button>
            )}
            {lab.researchGuide.planChoice && (
              <p role="status">
                {
                  {
                    selected: '已选择方案，可继续比较和修改',
                    custom: '已保存自己的偏好，候选不会自动确认',
                    uncertain: '方向仍未知，不会自动选择AI推荐；可先以较小范围为讨论起点',
                    none: '已记录现有方案不适用，请补充偏好或继续自主研究',
                  }[lab.researchGuide.planChoice.kind]
                }
              </p>
            )}
          </fieldset>
          <section className="planning-decisions">
            <h2>只处理会影响方向的问题</h2>
            <p>
              {
                activeQuestions.slice(0, 3).filter((q) => inspectDecision(q).generation === 'ready')
                  .length
              }
              道选择题可直接比较；其余问题按状态保留，不阻塞候选方案。
            </p>
            {activeQuestions.slice(0, 3).map((q) => (
              <article key={q.id} data-testid="planning-question">
                <h3>{q.title}</h3>
                <p>
                  {q.priority.reason} {q.detail}
                </p>
                <ResearchDecision
                  project={p}
                  question={q}
                  update={a.update}
                  disabled={a.readonly || a.busy}
                  active={!a.hidden}
                />
                {q.response && (
                  <button
                    disabled={a.busy}
                    onClick={() =>
                      a.onAnalyze(
                        'propose_roles',
                        q.findingIds.map((id) => `finding:${id}`),
                      )
                    }
                  >
                    按这个回答补充关联方案
                  </button>
                )}
              </article>
            ))}
            {otherQuestions.length > 0 && (
              <details>
                <summary>其他{otherQuestions.length}个问题与已记录决定，可稍后处理</summary>
                {otherQuestions.map((q) => (
                  <details key={q.id}>
                    <summary>
                      {q.title} ·{' '}
                      {q.status === 'answered'
                        ? '已回答'
                        : q.response?.kind === 'uncertain'
                          ? '保留未知'
                          : '保留未决'}
                    </summary>
                    <ResearchDecision
                      project={p}
                      question={q}
                      update={a.update}
                      disabled={a.readonly || a.busy}
                      active={!a.hidden}
                    />
                    {q.response && (
                      <button
                        disabled={a.busy || a.readonly}
                        onClick={() =>
                          a.onAnalyze(
                            'propose_roles',
                            q.findingIds.map((id) => `finding:${id}`),
                          )
                        }
                      >
                        按这个回答补充关联方案
                      </button>
                    )}
                  </details>
                ))}
                <button onClick={a.onCollaborate}>进入共同研究处理全部问题</button>
              </details>
            )}
          </section>
          {chosen.length > 0 && (
            <section className="planning-package">
              <h2>准备生成的资料包</h2>
              <p>
                将明确采纳选定方案、优先功能及勾选的岗位要求。来源属性不变，导入工作台后仍需再次确认。
              </p>
              <fieldset>
                <legend>希望带入岗位讨论的要求</legend>
                {requirements.map((r) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      checked={picked.includes(r.id)}
                      disabled={a.readonly}
                      onChange={(e) =>
                        setSelection(
                          e.target.checked ? [...picked, r.id] : picked.filter((id) => id !== r.id),
                        )
                      }
                    />
                    <span>
                      {r.title}
                      <small>
                        {requirementTypeNames[r.requirementType]} · {r.evidenceIds.length}条来源依据
                        · {r.status === 'confirmed' ? '已确认' : '候选'}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {critical.length > 0 && (
                <label>
                  <input
                    type="checkbox"
                    checked={ack === conflictSignature(p)}
                    onChange={(e) => setAck(e.target.checked ? conflictSignature(p) : null)}
                  />
                  我理解上述重要冲突与未知，明确同意带着这些假设继续，保留它们在资料包中。
                </label>
              )}
              <button
                data-tour="lab-package"
                className="lab-primary"
                disabled={a.busy || a.readonly || (!picked.length && !noHire)}
                onClick={() => {
                  if (a.update((n) => confirmPlanningPackage(n, picked, ack)))
                    a.onScreen('handoff');
                }}
              >
                确认方案并生成资料包
                <ArrowRight size={16} />
              </button>
            </section>
          )}
          <div className="planning-secondary">
            <button onClick={a.onSnapshot}>保存草稿快照</button>
            <button onClick={() => a.onExport('package')}>导出当前研究草稿</button>
            <button onClick={a.onCollaborate}>和AI一起深入研究</button>
          </div>
        </>
      )}
      {screen === 'handoff' && (
        <>
          {!ready && (
            <p className="planning-critical">
              相关内容发生变化，请重新核对方案与所选要求；旧快照仍保留。
            </p>
          )}
          <GuidedHandoff {...a} />
          <button onClick={() => a.onScreen('results')}>返回方案与选择</button>
        </>
      )}
    </main>
  );
}
