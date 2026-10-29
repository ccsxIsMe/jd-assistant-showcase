'use client';
import { buildSoftwareBundle } from './software';
import { database, readRecord, writeRecords } from '../storage/database';
import { explorationStore } from '../exploration/storage';
import { workspaceStore } from '../workbench/storage';
import { resumeStore } from '../resume/storage';
import { assetReferences } from '../exploration/research';
import { assertLab } from '../lab/graph';
import { makeId } from '../exploration/model';
export type DemoRecord = {
  id: string;
  projectId: string;
  workspaceId: string;
  reviewId: string;
  instanceId: string;
  seed: 'inputs' | 'complete';
  createdAt: string;
};
export type DemoStage = 'plan' | 'research' | 'board' | 'workbench' | 'resume' | 'history';
const pending = new Map<string, Promise<DemoRecord>>();
export function ensureDemo(seed: 'inputs' | 'complete', reset = false): Promise<DemoRecord> {
  const key = `software-engineer:1:${seed}`;
  const existing = pending.get(key);
  if (existing) return existing;
  async function run() {
    const old = await readRecord<DemoRecord | undefined>('demo-instances', key);
    if (old && !reset) {
      if ((await explorationStore.get(old.projectId))?.trashedAt)
        throw new Error(
          '这个示例探索已移至回收站；请先恢复，或在示例管理中明确重置。原快照仍保留。',
        );
      if (
        !(await explorationStore.get(old.projectId)) ||
        !(await workspaceStore.get(old.workspaceId)) ||
        !(await resumeStore.get(old.reviewId))
      )
        throw new Error('示例记录不完整；已有编辑保留，请在示例管理中明确重置。');
      return old;
    }
    const bundle = await buildSoftwareBundle(seed);
    const record: DemoRecord = {
      id: key,
      projectId: bundle.project.id,
      workspaceId: bundle.workspace.id,
      reviewId: bundle.review.id,
      instanceId: bundle.demo.instanceId,
      seed,
      createdAt: new Date().toISOString(),
    };
    const entries: Parameters<typeof writeRecords>[0] = [
      { store: 'explorations', value: bundle.project },
      { store: 'workspaces', value: bundle.workspace },
      { store: 'resume-reviews', value: bundle.review },
      { store: 'demo-instances', value: record },
    ];
    if (old)
      for (const [store, id] of [
        ['explorations', old.projectId],
        ['workspaces', old.workspaceId],
        ['resume-reviews', old.reviewId],
      ] as const) {
        const row = await readRecord<
          { id: string; demo?: { instanceId: string; kind: string; retired?: boolean } } | undefined
        >(store, id);
        if (row?.demo?.instanceId === old.instanceId && row.demo.kind === 'demo') {
          const archived = { ...row, demo: { ...row.demo, retired: true } };
          entries.push({ store, value: archived });
        }
      }
    await writeRecords(entries);
    return record;
  }
  const work = (async () =>
    navigator.locks ? await navigator.locks.request(key, run) : await run())().finally(() =>
    pending.delete(key),
  );
  pending.set(key, work);
  return work;
}
export async function demoDestination(record: DemoRecord, stage: DemoStage) {
  if (stage === 'workbench') return `/workspaces/${record.workspaceId}`;
  if (stage === 'resume') return `/match?review=${record.reviewId}`;
  if (stage === 'history') return `/explore/history?project=${record.projectId}`;
  const p = await explorationStore.get(record.projectId);
  if (!p?.lab) throw new Error('示例研究不存在。');
  p.lab.ui.researchMode = stage === 'plan' ? 'plan' : 'collaborate';
  p.lab.ui.researchView = stage === 'board' ? 'board' : 'guided';
  await explorationStore.save(p);
  return `/lab/${p.id}`;
}
export function remapDemoObjectIds<T>(value: T): T {
  const map = new Map<string, string>(),
    re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const replace = (s: string) =>
    s.replace(re, (id) => {
      if (!map.has(id)) map.set(id, makeId());
      return map.get(id)!;
    });
  function walk(v: unknown): unknown {
    if (typeof v === 'string') return replace(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, v]) => [replace(k), walk(v)]));
    return v;
  }
  return walk(value) as T;
}
export async function copyDemoAsPersonal(record: DemoRecord) {
  const project = await explorationStore.get(record.projectId),
    workspace = await workspaceStore.get(record.workspaceId),
    review = await resumeStore.get(record.reviewId);
  if (!project || !workspace || !review) throw new Error('示例不完整，未创建副本。');
  const ids = [...new Set([project, ...project.snapshots].flatMap(assetReferences))];
  const assets = await Promise.all(
    ids.map(async (id) => {
      const a = await explorationStore.asset(id);
      if (!a) throw new Error('示例源文件缺失，未创建不完整副本。');
      return a;
    }),
  );
  const data = remapDemoObjectIds({
    project,
    workspace,
    review,
    assets: assets.map(({ id, explorationId, name }) => ({ id, explorationId, name })),
  });
  const instanceId = makeId();
  for (const row of [data.project, data.workspace, data.review]) {
    row.demo = {
      ...row.demo!,
      kind: 'personal-copy',
      instanceId,
      originInstanceId: record.instanceId,
      retired: false,
    };
    row.title = `${row.title} · 个人副本`.slice(0, 190);
  }
  assertLab(data.project);
  await writeRecords([
    { store: 'explorations', value: data.project },
    { store: 'workspaces', value: data.workspace },
    { store: 'resume-reviews', value: data.review },
    ...data.assets.map((a, i) => ({
      store: 'exploration-assets' as const,
      value: { ...a, blob: assets[i].blob },
    })),
  ]);
  return {
    ...record,
    projectId: data.project.id,
    workspaceId: data.workspace.id,
    reviewId: data.review.id,
    instanceId,
  };
}
export async function demoRecords() {
  const db = await database();
  return new Promise<DemoRecord[]>((resolve, reject) => {
    const tx = db.transaction('demo-instances');
    const r = tx.objectStore('demo-instances').getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('示例目录读取失败。'));
  });
}
