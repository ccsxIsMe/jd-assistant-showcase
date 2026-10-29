'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Modal } from './modal';
import { Button } from '../ui/button';
import { explorationStore } from '@/lib/exploration/storage';
import { materialFromSnapshot, validateMaterial } from '@/lib/exploration/material';
import { applyUpstreamPlan, upstreamPlan } from '@/lib/exploration/workbench-import';
import type { RequirementMaterial } from '@/lib/exploration/material-model';
import type { Workspace } from '@/lib/workbench/model';
import { makeId, timestamp, basisNames } from '@/lib/exploration/model';
export function ResearchImportPanel({
  workspace: w,
  update,
  flush,
}: {
  workspace: Workspace;
  update: (fn: (w: Workspace) => Workspace) => boolean;
  flush: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [recordId, setRecordId] = useState(w.researchImports?.[0]?.id ?? '');
  const [latest, setLatest] = useState<RequirementMaterial | null>(null);
  const [plan, setPlan] = useState<ReturnType<typeof upstreamPlan> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const record = w.researchImports?.find((r) => r.id === recordId) ?? w.researchImports?.[0];
  if (!w.researchImports?.length) return null;
  function prepare(material: RequirementMaterial) {
    if (!record) throw new Error('导入记录不存在');
    const next = upstreamPlan(w, record, material);
    setLatest(material);
    setPlan(next);
    setSelected(next.entries.filter((e) => e.kind === 'removed').map((e) => e.featureId));
  }
  async function check() {
    if (!record || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const versions = (await explorationStore.snapshots())
        .filter(
          (r) =>
            (r.snapshot.lineage?.rootSnapshotId ?? r.snapshot.snapshotId) === record.lineageRootId,
        )
        .sort(
          (a, b) =>
            b.snapshot.version - a.snapshot.version ||
            b.snapshot.createdAt.localeCompare(a.snapshot.createdAt),
        );
      if (!versions[0])
        throw new Error(
          '原研究快照不在本机或已删除；已导入资料仍保留。可选择新版产品需求资料JSON核对。',
        );
      const m = materialFromSnapshot(versions[0].snapshot);
      prepare(m);
      setNotice(
        m.snapshotId === record.material.snapshotId
          ? '当前已是最新检查的保存版本；仍可查看未导入功能和历史差异。'
          : `发现保存的上游版本V${m.snapshotVersion}。仅显示差异，尚未修改岗位。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '检查失败，未修改任何岗位内容');
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!record || !latest || !plan || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!update((current) => applyUpstreamPlan(current, record.id, latest, plan, selected)))
        throw new Error('更新未接受，请检查版本、锁定项及保存错误。');
      await flush();
      await explorationStore.recordTransfer(latest.explorationId, {
        id: makeId(),
        snapshotId: latest.snapshotId,
        kind: 'upstream-sync',
        at: timestamp(),
        workspaceId: w.id,
        version: latest.snapshotVersion,
      });
      setPlan(null);
      setNotice('已按选择同步。删除的上游功能只使下游条目需复核，正文均保留。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败，原编辑保留。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="research-handoff-status">
        <span>产品研究来源 · {w.researchImports.length}条版本记录</span>
        <button
          onClick={() => {
            setOpen(true);
            setRecordId(w.researchImports![0].id);
          }}
        >
          查看来源与候选依据
        </button>
        <button
          onClick={() => {
            setOpen(true);
            void check();
          }}
        >
          检查上游更新
        </button>
      </div>
      {open && (
        <Modal
          title="产品研究来源与上游更新"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          wide
        >
          <div className="form-stack exploration-form">
            <label>
              研究导入记录
              <select
                className="field"
                aria-label="研究导入记录"
                value={recordId}
                onChange={(e) => {
                  setRecordId(e.target.value);
                  setPlan(null);
                  setLatest(null);
                  setError('');
                }}
              >
                {w.researchImports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.material.title} · 最近检查V{r.material.snapshotVersion}
                  </option>
                ))}
              </select>
            </label>
            {record && (
              <>
                <p>
                  原始快照：
                  <Link href={`/explore/snapshots/${record.material.snapshotId}`}>
                    {record.material.title} · V{record.material.snapshotVersion}
                  </Link>
                </p>
                <p>
                  {record.material.mode === 'example'
                    ? '演示数据，非真实AI分析。'
                    : '真实模式研究资料。'}
                  源研究确认不等于岗位确认，当前岗位条目状态由本工作台独立维护。
                </p>
                <details open>
                  <summary>对应功能、约束与人工确认状态</summary>
                  {w.items
                    .filter((i) => i.researchLink?.importId === record.id)
                    .map((i) => {
                      const version = [record.material, ...(record.versions ?? [])].find(
                        (m) => m.snapshotId === i.researchLink!.snapshotId,
                      );
                      const feature = version?.features.find((f) =>
                        i.researchLink!.featureIds.includes(f.id),
                      );
                      return (
                        <article className="research-trace-card" key={i.id}>
                          <b>{i.title}</b>
                          <p>
                            来自V{i.researchLink!.version} · 产品功能：
                            {feature?.title ?? '已保存的历史功能'} · 来源结论
                            {i.researchLink!.sourceStatus === 'confirmed'
                              ? '经过人工确认'
                              : '尚待确认或复核'}
                            ；岗位仍独立确认。
                          </p>
                          <p>产品功能依据：{feature?.description}</p>
                          {i.researchLink?.roleOrigin && (
                            <p>
                              岗位方案：
                              {version?.roleData?.solutions.find(
                                (s) => s.id === i.researchLink!.roleOrigin!.solutionId,
                              )?.title ?? i.researchLink.roleOrigin.solutionId}{' '}
                              · 独立要求：{i.researchLink.roleOrigin.requirementId}{' '}
                              <Link href={`/lab/snapshots/${i.researchLink.snapshotId}`}>
                                在证据板追溯 →
                              </Link>
                            </p>
                          )}
                          <p>约束：{version?.constraints.join('；') || '原研究未明确'}</p>
                          <Link
                            href={`/explore/snapshots/${i.researchLink!.snapshotId}#snapshot-feature-${feature?.id}`}
                          >
                            查看源快照与对应功能 →
                          </Link>
                          {i.researchLink!.evidenceIds.map((id) => {
                            const evidence = version?.evidenceRecords.find(
                              (e) => e.evidenceId === id,
                            );
                            const source = version?.sourceRecords.find(
                              (s) => s.id === evidence?.sourceId,
                            );
                            return (
                              <details key={id}>
                                <summary>
                                  {source?.title ?? '保存的来源'} · 证据 {id}
                                </summary>
                                <blockquote>
                                  {evidence?.excerpt || '无直接文字证据，需核实。'}
                                </blockquote>
                                <p>
                                  {evidence
                                    ? `来源v${evidence.sourceRevision}；${evidence.verificationStatus === 'verified' ? '原保存版本已定位' : '待核实'}`
                                    : '此证据未保存'}{' '}
                                  · {feature ? basisNames[feature.basis] : ''}
                                </p>
                              </details>
                            );
                          })}
                        </article>
                      );
                    })}
                </details>
              </>
            )}
            <div className="explore-inline-actions">
              <Button variant="outline" disabled={busy || !record} onClick={() => void check()}>
                检查上游更新
              </Button>
              <label className="explore-import">
                选择新版产品需求资料JSON
                <input
                  aria-label="选择上游需求资料JSON"
                  type="file"
                  accept=".json"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setError('');
                    try {
                      if (file.size > 20 * 1024 * 1024) throw new Error('需求资料超过20MB');
                      prepare(validateMaterial(JSON.parse(await file.text())));
                    } catch (error) {
                      setError(error instanceof Error ? error.message : '资料格式不合法');
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {notice && (
              <p role="status" className="callout">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="callout error">
                {error}
              </p>
            )}
            {plan && (
              <section>
                <h3>上游V{latest?.snapshotVersion}差异预览</h3>
                <p>
                  普通检查不改正文；仅在下方明确选择后同步。锁定正文不能更新，人工修改默认不选。
                </p>
                {plan.entries.map((entry) => (
                  <article className="upstream-change" key={entry.featureId}>
                    <label className="explore-checkbox">
                      <input
                        type="checkbox"
                        disabled={entry.locked && entry.kind !== 'removed'}
                        checked={selected.includes(entry.featureId)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, entry.featureId]
                              : selected.filter((id) => id !== entry.featureId),
                          )
                        }
                      />
                      <b>
                        {
                          {
                            added: '尚未导入的功能',
                            changed: '上游功能变化',
                            removed: '上游功能移除 / 排除',
                          }[entry.kind]
                        }
                      </b>
                    </label>
                    <p>
                      {entry.locked ? '本地已锁定。' : ''}
                      {entry.locallyEdited
                        ? '本地已有人工编辑，保留为默认；如需替换请明确选择。'
                        : ''}
                    </p>
                    {entry.itemId && (
                      <div className="analysis-before">
                        本地当前正文：{w.items.find((i) => i.id === entry.itemId)?.text}
                      </div>
                    )}
                    <div className="analysis-before">原上游：{entry.before || '未导入'}</div>
                    <div className="analysis-after">新上游：{entry.after}</div>
                    {entry.kind === 'removed' && (
                      <p>选择后仅标记相关任务、能力要求和JD需复核，不自动删除或改写正文。</p>
                    )}
                  </article>
                ))}
                {plan.constraintsChanged && (
                  <p className="callout warning">
                    产品约束已变化。应用时会记录待确认问题，岗位正文不会据此自动重写。
                  </p>
                )}
                {!plan.entries.length && !plan.constraintsChanged && <p>没有可同步差异。</p>}
                <Button
                  disabled={busy || (!selected.length && !plan.constraintsChanged)}
                  onClick={() => void apply()}
                >
                  同步所选变更并保留其他编辑
                </Button>
              </section>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
