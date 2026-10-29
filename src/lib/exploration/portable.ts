'use client';
import { z } from 'zod';
import {
  explorationSchema,
  snapshotSchema,
  makeId,
  timestamp,
  type Exploration,
  type Snapshot,
} from './model';
import { explorationStore, type Asset } from './storage';
import { validateSignature } from './files';
import { assetReferences, forkResearch } from './research';
import { rebindLabProject, assertLab } from '../lab/graph';
const packageSchema = z
  .object({
    format: z.literal('product-exploration-package'),
    version: z.literal(1),
    modeNotice: z.enum(['演示数据，非真实AI分析', '真实AI候选，仍需人工核实']).optional(),
    fixtureNotice: z.string().max(200).optional(),
    project: explorationSchema.optional(),
    snapshot: snapshotSchema.optional(),
    assets: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            name: z.string().max(300),
            mime: z.enum([
              'image/png',
              'image/jpeg',
              'image/webp',
              'application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'text/plain',
              'text/markdown',
              'video/mp4',
            ]),
            base64: z.string().max(85000000),
          })
          .strict(),
      )
      .max(2500),
  })
  .strict()
  .refine((v) => !!v.project !== !!v.snapshot, '一次只能导入项目或快照');
export function referencedAssets(value: Exploration | Snapshot): string[] {
  const all = 'snapshots' in value ? [value, ...value.snapshots] : [value];
  return [...new Set(all.flatMap((record) => assetReferences(record)))];
}
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('附件导出失败。'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
/** 便携导出时按引用收集并去重附件；Base64 只用于交换包，不是日常快照存储。 */
export async function exportPackage(value: Exploration | Snapshot) {
  const assets = [];
  let size = 0;
  for (const id of referencedAssets(value)) {
    const asset = await explorationStore.asset(id);
    if (!asset) throw new Error('原始附件缺失，无法导出完整包。请补充附件或仅下载Markdown。');
    size += asset.blob.size;
    if (size > 60 * 1024 * 1024) throw new Error('附件合计超过60MB便携包限制，请精简来源。');
    assets.push({ id, name: asset.name, mime: asset.blob.type, base64: await base64(asset.blob) });
  }
  const output = JSON.stringify({
    format: 'product-exploration-package',
    ...(('snapshots' in value ? value.demo : value.research?.demo)
      ? {
          fixtureNotice: `示例项目｜虚构材料｜${value.mode === 'example' ? '预置分析结果' : '真实AI重分析'}`,
        }
      : {}),
    version: 1,
    modeNotice: value.mode === 'example' ? '演示数据，非真实AI分析' : '真实AI候选，仍需人工核实',
    ...('snapshots' in value ? { project: value } : { snapshot: value }),
    assets,
  });
  if (output.length > 95 * 1024 * 1024)
    throw new Error(
      '完整研究包超过95MB限制。请派生较小研究或导出轻量产品需求资料；原记录保持不变。',
    );
  return output;
}
/** 先校验结构，再校验跨记录 ID、来源版本及附件引用；合法 JSON 不等于合法研究包。 */
export function parsePackage(text: string) {
  if (text.length > 95 * 1024 * 1024) throw new Error('导入包超过95MB限制。');
  const data = packageSchema.parse(JSON.parse(text));
  const value = data.project ?? data.snapshot!;
  const records = 'snapshots' in value ? [value, ...value.snapshots] : [value];
  const all: (Exploration | Snapshot | import('./model').ResearchState)[] = [...records];
  for (const record of records)
    if ('research' in record && record.research) all.push(record.research);
  for (const record of all) {
    if ('lab' in record && record.lab) {
      const owner =
        'id' in record
          ? record.id
          : 'explorationId' in record
            ? record.explorationId
            : record.lab.nodes[0]?.projectId;
      if (owner) assertLab({ ...record, id: owner } as Exploration);
    }
    const sourceIds = new Set(record.sources.map((s) => s.id));
    if (
      record.sources.some(
        (s) => new Set(s.versions.map((v) => v.revision)).size !== s.versions.length,
      )
    )
      throw new Error('来源版本号重复，不能定位唯一证据。');
    const evidenceIds = new Set(record.evidence.map((e) => e.evidenceId));
    const findingIds = new Set(record.findings.map((f) => f.id));
    if (
      sourceIds.size !== record.sources.length ||
      evidenceIds.size !== record.evidence.length ||
      findingIds.size !== record.findings.length
    )
      throw new Error('导入包包含重复ID。');
    if (
      record.evidence.some(
        (e) =>
          e.sourceId &&
          (!sourceIds.has(e.sourceId) ||
            !record.sources.some(
              (s) => s.id === e.sourceId && s.versions.some((v) => v.revision === e.sourceRevision),
            )),
      ) ||
      record.findings.some(
        (f) =>
          f.evidenceIds.some((id) => !evidenceIds.has(id)) ||
          (f.parentId && !findingIds.has(f.parentId)),
      )
    )
      throw new Error('导入包包含无效来源或结论关联。');
  }
  if (
    new Set(data.assets.map((a) => a.id)).size !== data.assets.length ||
    referencedAssets(value).some((id) => !data.assets.some((a) => a.id === id))
  )
    throw new Error('导入包附件缺失或重复。');
  return data;
}
/** 校验文件内容并重绑项目、快照、附件 ID 后原子写入独立副本，原记录保持不变。 */
export async function importPackage(file: File) {
  if (file.size > 95 * 1024 * 1024) throw new Error('导入包超过95MB限制。');
  const data = parsePackage(await file.text());
  const project = data.project
    ? structuredClone(data.project)
    : Object.assign(forkResearch(data.snapshot!, data.snapshot!.title, true), {
        snapshots: [data.snapshot!],
      });
  project.id = makeId();
  if (project.lab) project.lab = rebindLabProject(project.lab, project.id);
  project.title = (project.title + ' · 导入副本').slice(0, 200);
  project.createdAt = project.updatedAt = timestamp();
  project.revision = 1;
  const assetIds = new Map<string, string>();
  const assets: Asset[] = [];
  let size = 0;
  for (const raw of data.assets) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw.base64)) throw new Error('附件编码不合法。');
    const bytes = Uint8Array.from(atob(raw.base64), (c) => c.charCodeAt(0));
    size += bytes.byteLength;
    if (size > 60 * 1024 * 1024) throw new Error('附件合计超过60MB限制。');
    const blob = new Blob([bytes], { type: raw.mime });
    await validateSignature(blob, raw.mime);
    const id = makeId();
    assetIds.set(raw.id, id);
    assets.push({ id, explorationId: project.id, blob, name: raw.name });
  }
  const recordsToRemap: (Exploration | Snapshot | import('./model').ResearchState)[] = [
    project,
    ...project.snapshots,
  ];
  for (const snapshot of project.snapshots)
    if (snapshot.research) recordsToRemap.push(snapshot.research);
  for (const snapshot of project.snapshots) {
    if (!snapshot.research) continue;
    snapshot.research.archive.assetIds = snapshot.research.archive.assetIds.map(
      (id) => assetIds.get(id) ?? id,
    );
    snapshot.research.archive.missingAssetIds = snapshot.research.archive.missingAssetIds.map(
      (id) => assetIds.get(id) ?? id,
    );
  }
  const partsToRemap: Pick<Exploration, 'sources' | 'evidence'>[] = [...recordsToRemap];
  for (const record of recordsToRemap)
    if ('operations' in record)
      for (const operation of record.operations ?? [])
        partsToRemap.push(operation.before, operation.after);
  for (const record of partsToRemap) {
    if ('lab' in record && record.lab) {
      const lab = record.lab as import('../lab/model').LabState;
      for (const key of ['nodes', 'edges', 'annotations', 'solutions', 'requirements'] as const)
        for (const item of lab[key]) item.projectId = project.id;
      for (const a of lab.annotations)
        if (a.assetId) a.assetId = assetIds.get(a.assetId) ?? a.assetId;
    }
    for (const source of record.sources)
      for (const version of source.versions)
        if (version.assetId) version.assetId = assetIds.get(version.assetId) ?? version.assetId;
    for (const evidence of record.evidence) {
      if (evidence.location.kind === 'image')
        evidence.location.assetId =
          assetIds.get(evidence.location.assetId) ?? evidence.location.assetId;
      if (evidence.location.kind === 'video' && evidence.location.frameAssetId)
        evidence.location.frameAssetId =
          assetIds.get(evidence.location.frameAssetId) ?? evidence.location.frameAssetId;
    }
  }
  const exported = new Set(project.exportedSnapshotIds);
  project.exportedSnapshotIds = [];
  const snapshotIds = new Map(project.snapshots.map((s) => [s.snapshotId, makeId()]));
  const independentRoot = project.snapshots.at(-1)?.snapshotId;
  for (const snapshot of project.snapshots) {
    const old = snapshot.snapshotId;
    snapshot.importedFrom = old;
    snapshot.snapshotId = snapshotIds.get(old)!;
    snapshot.explorationId = project.id;
    if (snapshot.research?.lab) rebindLabProject(snapshot.research.lab, project.id);
    snapshot.lineage = {
      rootSnapshotId: snapshotIds.get(independentRoot ?? old) ?? snapshot.snapshotId,
      parentSnapshotId: snapshot.lineage?.parentSnapshotId
        ? (snapshotIds.get(snapshot.lineage.parentSnapshotId) ?? null)
        : null,
      copiedFromSnapshotId: old,
    };
    if (exported.has(old) || !!data.snapshot) project.exportedSnapshotIds.push(snapshot.snapshotId);
  }
  project.baseSnapshotId = undefined;
  project.lineageRootId = undefined;
  project.activity.unshift({
    id: makeId(),
    at: timestamp(),
    text: '导入为独立副本，原项目、快照和附件未覆盖。',
  });
  await explorationStore.import(explorationSchema.parse(project), assets);
  return project;
}
