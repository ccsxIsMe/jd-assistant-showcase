'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../workbench/modal';
import type { Snapshot } from '@/lib/exploration/model';
import { materialFromSnapshot } from '@/lib/exploration/material';
import { importRequirementMaterial } from '@/lib/exploration/workbench-import';
import { workspaceStore } from '@/lib/workbench/storage';
import { newWorkspace } from '@/lib/workbench/model';
import { explorationStore } from '@/lib/exploration/storage';
import { makeId, timestamp } from '@/lib/exploration/model';
export function LabImportDialog({
  snapshot,
  onClose,
}: {
  snapshot: Snapshot;
  onClose: () => void;
}) {
  const router = useRouter(),
    m = materialFromSnapshot(snapshot),
    d = m.roleData!;
  const plans = d.solutions.filter(
    (s) => d.selectedSolutionIds.includes(s.id) && s.status === 'confirmed',
  );
  const available = d.requirements.filter(
    (r) => r.status === 'confirmed' && plans.some((s) => s.id === r.solutionId),
  );
  const prepared = snapshot.research?.lab?.researchGuide.importRequirementIds ?? [];
  const [ids, setIds] = useState(
    available.filter((r) => !prepared.length || prepared.includes(r.id)).map((r) => r.id),
  );
  const [title, setTitle] = useState(plans[0]?.roles[0]?.title ?? '产品实施岗位');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const features = new Set(
    available
      .filter((r) => ids.includes(r.id))
      .flatMap((r) => r.relatedFeatureIds)
      .filter((id) => m.features.some((f) => f.id === id)),
  );
  const roleOnly = available.filter(
    (r) => ids.includes(r.id) && !r.relatedFeatureIds.some((id) => features.has(id)),
  );
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      if (!ids.length) throw new Error('至少选择一项已确认要求。');
      const raw = {
        ...m,
        roleData: {
          ...d,
          solutions: plans,
          requirements: available.filter((r) => ids.includes(r.id)),
          selectedSolutionIds: plans.map((s) => s.id),
        },
      };
      const w = importRequirementMaterial(newWorkspace(title), raw, [...features], true);
      await workspaceStore.save(w);
      await explorationStore.recordTransfer(m.explorationId, {
        id: makeId(),
        kind: 'workbench-import',
        snapshotId: m.snapshotId,
        at: timestamp(),
        workspaceId: w.id,
        version: m.snapshotVersion,
      });
      router.push(`/workspaces/${w.id}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败');
      setBusy(false);
    }
  }
  return (
    <Modal title="导入预览 · 岗位共创工作台" onClose={onClose} wide>
      <div className="form-stack">
        <p className="callout">
          {m.mode === 'example' ? '演示数据，非真实AI分析。' : ''}快照 V{m.snapshotVersion}：
          {m.objective || snapshot.research?.originalObjective}
          。导入后任务和要求全部待确认，不改变已有岗位。
        </p>
        <label>
          新岗位名称
          <input
            aria-label="导入岗位名称"
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <h3>已确认的候选方案</h3>
        {plans.map((s) => (
          <p key={s.id}>
            {s.title} · {s.assumptions.join('；')}
          </p>
        ))}
        <h3>选择部分岗位要求</h3>
        {available.map((r) => (
          <label key={r.id}>
            <input
              type="checkbox"
              checked={ids.includes(r.id)}
              onChange={(e) =>
                setIds(e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id))
              }
            />
            {r.title} · 关联{r.relatedFeatureIds.length}项功能 / {r.evidenceIds.length}条证据
          </label>
        ))}
        {!available.length && <p>请返回证据板，确认方案及至少一项岗位要求。</p>}
        <h3>同时导入的功能</h3>
        {m.features
          .filter((f) => features.has(f.id))
          .map((f) => (
            <p key={f.id}>
              {f.title} ·{' '}
              {f.basis === 'inferred'
                ? 'AI推断'
                : f.basis === 'observed'
                  ? '参考资料能力'
                  : '用户提出的需求'}
            </p>
          ))}
        {roleOnly.length > 0 && (
          <p className="callout subtle">
            {roleOnly.length}
            项要求直接依据资料或推断，未关联产品功能。将作为岗位交付候选带入，不虚构产品功能；任务和要求仍待确认。
          </p>
        )}
        <h3>来源与待确认问题</h3>
        <h3>约束与依赖</h3>
        <p>{m.constraints.join('；') || '尚未明确，继续保留为未知。'}</p>
        <p>{m.sourceManifest.map((s) => `${s.title} V${s.revision}`).join('；')}</p>
        {m.openQuestions.map((q) => (
          <p key={q.id}>{q.title}</p>
        ))}
        {error && (
          <p role="alert" className="callout error">
            {error}
          </p>
        )}
        <button
          className="lab-primary"
          disabled={busy || !ids.length || !title.trim()}
          onClick={() => void save()}
        >
          {busy ? '正在保存岗位…' : '确认导入为待确认任务与要求'}
        </button>
        <small>来源快照、方案、要求、功能和证据ID保留。后续研究更新不会静默覆盖岗位。</small>
      </div>
    </Modal>
  );
}
