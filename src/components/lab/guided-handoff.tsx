'use client';
import { researchProgress } from '@/lib/lab/guided';
import { chooseImportRequirements } from '@/lib/lab/operations';
import { requirementTypeNames } from '@/lib/lab/model';
import { planningConstraintText } from '@/lib/lab/planning';
import type { GuidedActions } from './guided-types';
export function ImportSelection(a: Pick<GuidedActions, 'project' | 'update' | 'readonly'>) {
  const state = researchProgress(a.project);
  return (
    <fieldset className="guided-import-selection">
      <legend>准备带入岗位工作台的要求</legend>
      <p>只有选定方案中已确认的要求可以勾选。导入后会重新待确认，来源无需重复填写。</p>
      {state.requirements.map((r) => (
        <label key={r.id}>
          <input
            type="checkbox"
            data-tour="lab-import-selection"
            disabled={a.readonly}
            checked={state.selectedImportIds.includes(r.id)}
            onChange={(e) =>
              a.update((p) =>
                chooseImportRequirements(
                  p,
                  e.target.checked
                    ? [...state.selectedImportIds, r.id]
                    : state.selectedImportIds.filter((id) => id !== r.id),
                ),
              )
            }
          />
          <span>
            <strong>{r.title}</strong>
            <small>
              {requirementTypeNames[r.requirementType]} · {r.evidenceIds.length}条依据
            </small>
          </span>
        </label>
      ))}
      {!state.requirements.length && (
        <p>
          {state.plans.length > 0 && state.plans.every((s) => s.hiringNeed === 'not-needed')
            ? '当前选择暂不新增招聘。可以保存快照或导出研究包，无需强行生成岗位要求。'
            : '先选择并确认方案，再确认希望带入岗位的逐条要求。可以只导入一部分。'}
        </p>
      )}
    </fieldset>
  );
}
export function GuidedHandoff(a: GuidedActions) {
  const p = a.project,
    state = researchProgress(p);
  return (
    <div className="guided-handoff">
      <div className="guided-export-summary">
        <span className="guided-kicker">这份研究，将成为岗位讨论的起点</span>
        <h2>{p.overview.goal || p.initialObjective || p.title}</h2>
        <p>
          {state.features.filter((f) => f.status === 'confirmed').length}项确认功能 ·{' '}
          {state.features.filter((f) => f.status !== 'confirmed').length}项候选功能 ·{' '}
          {state.selectedImportIds.length}项准备导入的要求
        </p>
      </div>
      <ImportSelection {...a} />
      <p className="guided-muted">
        回答问题记录的是方向选择，不会自动确认功能、方案或岗位要求。已确认要求可以直接带入；没有关联产品功能时，会保留为岗位交付候选。
      </p>
      <section className="guided-section">
        <h2>导入预览</h2>
        <div className="guided-preview-grid">
          <div>
            <h3>已确认功能</h3>
            {state.features
              .filter((f) => f.status === 'confirmed')
              .map((f) => (
                <p key={f.id}>{f.title}</p>
              ))}
            <h3>待确认功能</h3>
            {state.features
              .filter((f) => f.status !== 'confirmed')
              .map((f) => (
                <p key={f.id}>
                  {f.title} · {f.basis === 'inferred' ? 'AI推断' : '候选'}
                </p>
              ))}
          </div>
          <div>
            <h3>约束与依赖</h3>
            <p>
              {planningConstraintText(p) ||
                p.overview.constraints ||
                '尚未明确，保留为待核实条件。'}
            </p>
            <h3>选定方案</h3>
            {state.plans.map((s) => (
              <article key={s.id}>
                <strong>{s.title}</strong>
                <p>{s.assumptions.join('；')}</p>
              </article>
            ))}
          </div>
        </div>
        <details>
          <summary>证据来源与未决问题</summary>
          {p.sources
            .filter((s) => !s.removed)
            .map((s) => (
              <button className="guided-source-link" key={s.id} onClick={() => a.onSource(s.id)}>
                {s.title} · V{s.versions.at(-1)!.revision} ↗
              </button>
            ))}
          {state.questions
            .filter((q) => q.status !== 'answered')
            .map((q) => (
              <p key={q.id}>
                {q.title} · {q.status === 'deferred' ? '已暂缓' : '待回答'}
              </p>
            ))}
        </details>
      </section>
      <div className="guided-handoff-actions">
        {!a.readonly && (
          <>
            <button
              className="lab-primary"
              data-tour="lab-import"
              disabled={!state.selectedImportIds.length || a.busy}
              onClick={a.onImport}
            >
              保存快照并预览导入
            </button>
            <button disabled={a.busy} onClick={a.onSnapshot}>
              仅保存研究快照
            </button>
          </>
        )}
        <button onClick={a.onHistory}>查看快照与比较版本</button>
        <button onClick={() => a.onExport('package')}>导出完整研究包</button>
        <button disabled={!p.snapshots.length} onClick={() => a.onExport('material')}>
          导出最近快照的产品需求JSON
        </button>
      </div>
      <p className="guided-muted">
        自动保存草稿与不可变快照分别管理。JSON基于已保存快照，完整包包含当前研究与附件。后续研究不会静默覆盖已有岗位。
      </p>
      {p.transfers
        ?.filter((t) => t.kind === 'workbench-import')
        .map((t) => (
          <p key={t.id}>
            已有实际导入记录：快照 V{t.version}，{new Date(t.at).toLocaleString('zh-CN')}。
          </p>
        ))}
    </div>
  );
}
