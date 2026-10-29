'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../workbench/modal';
import { Button } from '../ui/button';
import { explorationStore } from '@/lib/exploration/storage';
import { workspaceStore } from '@/lib/workbench/storage';
import { newWorkspace, type Workspace } from '@/lib/workbench/model';
import {
  materialFromSnapshot,
  materialFeatureEvidenceState,
  validateMaterial,
} from '@/lib/exploration/material';
import { importRequirementMaterial, roleDiscussion } from '@/lib/exploration/workbench-import';
import { importPackage, parsePackage } from '@/lib/exploration/portable';
import { makeId, timestamp, basisNames, type Snapshot } from '@/lib/exploration/model';
import type { RequirementMaterial } from '@/lib/exploration/material-model';
export function MaterialImportDialog({
  onClose,
  snapshot: initial,
  target,
  onInsert,
}: {
  onClose: () => void;
  snapshot?: Snapshot;
  target?: { id: string; title: string };
  onInsert?: (
    material: RequirementMaterial,
    featureIds: string[],
    acknowledge: boolean,
  ) => boolean | Promise<boolean>;
}) {
  const router = useRouter();
  const [materials, setMaterials] = useState<RequirementMaterial[]>(
    initial ? [materialFromSnapshot(initial)] : [],
  );
  const [selected, setSelected] = useState(initial?.snapshotId ?? '');
  const [featureIds, setFeatureIds] = useState(
    initial
      ? materialFromSnapshot(initial)
          .features.filter((f) => f.status === 'confirmed')
          .map((f) => f.id)
      : [],
  );
  const [jobs, setJobs] = useState<Workspace[]>([]);
  const [jobId, setJobId] = useState(target?.id ?? 'new');
  const [jobTitle, setJobTitle] = useState('待明确的产品实施岗位');
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [roleIds, setRoleIds] = useState<string[] | null>(null);
  const gate = useRef(false);
  useEffect(() => {
    if (!initial)
      explorationStore
        .snapshots()
        .then((rows) => setMaterials(rows.map((row) => materialFromSnapshot(row.snapshot))))
        .catch(() => setError('研究快照读取失败。'));
    if (!target)
      workspaceStore
        .list()
        .then(setJobs)
        .catch(() => setError('岗位读取失败。'));
  }, [initial, target]);
  const material = materials.find((m) => m.snapshotId === selected);
  const eligibleRoles =
    material?.roleData?.requirements.filter(
      (r) =>
        r.status === 'confirmed' &&
        material.roleData!.selectedSolutionIds.includes(r.solutionId) &&
        material.roleData!.solutions.some((s) => s.id === r.solutionId && s.status === 'confirmed'),
    ) ?? [];
  const chosenRoles = roleIds ?? eligibleRoles.map((r) => r.id);
  const needsAcknowledgement = !!material?.features.some(
    (f) =>
      featureIds.includes(f.id) &&
      (f.status !== 'confirmed' ||
        f.basis === 'inferred' ||
        materialFeatureEvidenceState(material, f.id) !== 'current'),
  );
  function choose(m?: RequirementMaterial) {
    setSelected(m?.snapshotId ?? '');
    setFeatureIds(m?.features.filter((f) => f.status === 'confirmed').map((f) => f.id) ?? []);
    setAcknowledge(false);
    setRoleIds(null);
  }
  async function fileImport(file?: File) {
    if (!file || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      if (file.size > 95 * 1024 * 1024) throw new Error('导入文件超过95MB限制。');
      const text = await file.text();
      const raw: unknown = JSON.parse(text);
      let m: RequirementMaterial;
      if (
        raw &&
        typeof raw === 'object' &&
        'format' in raw &&
        raw.format === 'product-requirements-material'
      )
        m = validateMaterial(raw);
      else {
        const pkg = parsePackage(text);
        if (!pkg.snapshot)
          throw new Error('请选择产品需求资料或完整研究快照包；整项目请到探索首页导入。');
        const p = await importPackage(file);
        m = materialFromSnapshot(p.snapshots[0]);
      }
      setMaterials((rows) => [...rows.filter((row) => row.snapshotId !== m.snapshotId), m]);
      choose(m);
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入格式不合法，原数据保留');
    } finally {
      setBusy(false);
      gate.current = false;
    }
  }
  async function save() {
    if (!material || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      const chosenMaterial = material.roleData
        ? {
            ...material,
            roleData: {
              ...material.roleData,
              solutions: material.roleData.solutions.filter(
                (s) =>
                  material.roleData!.selectedSolutionIds.includes(s.id) && s.status === 'confirmed',
              ),
              requirements: eligibleRoles.filter((r) => chosenRoles.includes(r.id)),
            },
          }
        : material;
      let workspaceId = target?.id;
      if (target && onInsert) {
        if (!(await onInsert(chosenMaterial, featureIds, acknowledge)))
          throw new Error('岗位未接受本次导入，请检查条目限制或关闭弹窗查看保存错误。');
      } else {
        const current =
          jobId === 'new' ? newWorkspace(jobTitle.trim()) : await workspaceStore.get(jobId);
        if (!current || !current.title.trim()) throw new Error('请选择有效岗位或填写名称。');
        const next = importRequirementMaterial(current, chosenMaterial, featureIds, acknowledge);
        await workspaceStore.save(next);
        workspaceId = next.id;
      }
      await explorationStore.recordTransfer(material.explorationId, {
        id: makeId(),
        snapshotId: material.snapshotId,
        kind: 'workbench-import',
        at: timestamp(),
        workspaceId,
        version: material.snapshotVersion,
      });
      if (!target && workspaceId) router.push(`/workspaces/${workspaceId}`);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入失败，原岗位内容保留。');
    } finally {
      setBusy(false);
      gate.current = false;
    }
  }
  return (
    <Modal title="导入产品需求快照到岗位" onClose={onClose} wide>
      <div className="form-stack exploration-form">
        <p>
          先预览产品范围，再选择岗位。所选功能会形成待讨论任务和技能建议，全部待确认；不会按一个功能确定一个职位、人数或已确认的岗位条件。
        </p>
        <label>
          选择已保存研究快照
          <select
            className="field"
            aria-label="选择产品需求快照"
            value={selected}
            onChange={(e) => choose(materials.find((m) => m.snapshotId === e.target.value))}
          >
            <option value="">请选择</option>
            {materials.map((m) => (
              <option key={m.snapshotId} value={m.snapshotId}>
                {m.title} · V{m.snapshotVersion} · {m.snapshotKind === 'draft' ? '草案' : '已确认'}{' '}
                · {m.mode === 'example' ? '演示' : '真实模式'}
              </option>
            ))}
          </select>
        </label>
        <label className="explore-import">
          或选择产品需求资料JSON / 研究快照包
          <input
            aria-label="选择需求快照JSON"
            type="file"
            accept=".json"
            disabled={busy}
            onChange={(e) => {
              void fileImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {material && (
          <>
            <div className="callout">
              <strong>
                {material.title} · V{material.snapshotVersion}
              </strong>
              {material.mode === 'example' && <p>演示数据，非真实AI分析</p>}
              <p>目标：{material.objective || '待补充'}</p>
              <p>用户：{material.targetUsers || '待补充'}</p>
              <p>关键约束：{material.constraints.join('；') || '尚未明确'}</p>
            </div>
            {material.roleData && (
              <fieldset className="material-feature-selection">
                <legend>选择已经确认的岗位方案要求</legend>
                {eligibleRoles.map((r) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      checked={chosenRoles.includes(r.id)}
                      onChange={(e) => {
                        setRoleIds(
                          e.target.checked
                            ? [...chosenRoles, r.id]
                            : chosenRoles.filter((id) => id !== r.id),
                        );
                        if (e.target.checked)
                          setFeatureIds([
                            ...new Set([
                              ...featureIds,
                              ...r.relatedFeatureIds.filter((id) =>
                                material.features.some((f) => f.id === id),
                              ),
                            ]),
                          ]);
                      }}
                    />
                    <span>
                      <strong>{r.title}</strong>
                      <small>
                        {material.roleData!.solutions.find((s) => s.id === r.solutionId)?.title} ·
                        导入后重新待确认
                      </small>
                    </span>
                  </label>
                ))}
                {!eligibleRoles.length && (
                  <p>此快照没有确认过的所选方案要求，请回到需求实验室确认并保存新快照。</p>
                )}
              </fieldset>
            )}
            <fieldset className="material-feature-selection">
              <legend>选择要讨论的产品功能</legend>
              {material.features.map((f) => (
                <label key={f.id}>
                  <input
                    type="checkbox"
                    checked={featureIds.includes(f.id)}
                    onChange={(e) =>
                      setFeatureIds(
                        e.target.checked
                          ? [...featureIds, f.id]
                          : featureIds.filter((id) => id !== f.id),
                      )
                    }
                  />
                  <span>
                    <strong>{f.title}</strong>
                    <small>
                      {f.status === 'confirmed' ? '原研究已确认' : '尚未确认 / 需复核'} ·{' '}
                      {basisNames[f.basis]} · {f.evidenceIds.length}条证据
                      {materialFeatureEvidenceState(material, f.id) !== 'current'
                        ? ' · 证据待核实'
                        : ''}
                    </small>
                    <p>{f.description}</p>
                  </span>
                </label>
              ))}
            </fieldset>
            <details open>
              <summary>未知问题与AI假设</summary>
              {material.openQuestions.map((q) => (
                <p key={q.id}>
                  待确认：{q.title} — {q.answer || q.detail}
                </p>
              ))}
              {material.assumptions.map((f) => (
                <p key={f.id}>
                  初步判断：{f.title} — {f.uncertainty || f.description}；依据：
                  {f.rationale || '需进一步核实'}
                </p>
              ))}
              {!material.openQuestions.length && !material.assumptions.length && (
                <p>暂无记录，不代表不存在未知项。</p>
              )}
            </details>
            <details>
              <summary>条件性的岗位角色与技能讨论建议</summary>
              {roleDiscussion(material).map((r) => (
                <p key={r.title}>
                  <b>{r.title}：</b>
                  {r.detail}
                </p>
              ))}
              <p>
                以上为程序生成的讨论框架。导入后可补充团队能力、分工与预算，再使用原有AI共创和JD流程；本次导入不发起模型调用。
              </p>
            </details>
            <details>
              <summary>来源与导出限制</summary>
              {material.sourceManifest.map((s) => (
                <p key={s.sourceId}>
                  {s.title} · v{s.revision} · {s.status}
                </p>
              ))}
              {material.archiveLimitations.map((text, index) => (
                <p key={index}>{text}</p>
              ))}
            </details>
            {needsAcknowledgement && (
              <label className="explore-checkbox">
                <input
                  type="checkbox"
                  aria-label="确认未核实内容仅作讨论候选"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                我理解未确认内容、推断或过期证据仅用于讨论，所有岗位候选仍需人工确认。
              </label>
            )}
          </>
        )}
        {target ? (
          <p>目标岗位：{target.title}</p>
        ) : (
          <>
            <label>
              导入目标
              <select
                className="field"
                aria-label="需求快照导入目标"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
              >
                <option value="new">新建一个岗位</option>
                {jobs.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
            {jobId === 'new' && (
              <label>
                岗位名称
                <input
                  className="field"
                  aria-label="快照目标岗位名称"
                  maxLength={200}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="callout error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              busy ||
              !material ||
              (!!material.roleData && !chosenRoles.length) ||
              !featureIds.length ||
              (needsAcknowledgement && !acknowledge) ||
              (jobId === 'new' && !jobTitle.trim())
            }
            onClick={() => void save()}
          >
            {busy ? '正在导入…' : '确认添加为岗位资料'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
