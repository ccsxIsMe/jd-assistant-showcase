import { readRecord, writeRecords } from '../storage/database';
import { explorationSchema, type Exploration } from './model';
import { database } from '../storage/database';
import { assetReferences } from './research';
import { timestamp } from './model';
import { workspaceSchema } from '../workbench/model';
import { changeProjectTrash, validateProjectSave } from './lifecycle';
import { reconcileDecisions } from '../decisions/records';

/** 同一读写事务中读取当前版本再校验保存，避免读取与写入间穿插回收站操作。 */
async function mutateProject(id: string, apply: (stored: Exploration | null) => Exploration) {
  const db = await database();
  return new Promise<Exploration>((resolve, reject) => {
    const tx = db.transaction('explorations', 'readwrite');
    const request = tx.objectStore('explorations').get(id);
    let result: Exploration, failure: unknown;
    request.onsuccess = () => {
      try {
        result = apply(request.result ? explorationSchema.parse(request.result) : null);
        tx.objectStore('explorations').put(result);
      } catch (error) {
        failure =
          error instanceof DOMException
            ? new Error('本地保存失败，原记录保留，请检查存储空间后重试。')
            : error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? new Error('本地保存失败，原记录保留，请重试。'));
    tx.onabort = () => reject(failure ?? new Error('保存被中断，原记录保留，请重试。'));
  });
}
export const PROJECT_LIFECYCLE_CHANNEL = 'jd-project-lifecycle';
export type Asset = { id: string; explorationId: string; blob: Blob; name: string };
export const explorationStore = {
  async list() {
    return (await readRecord<unknown[]>('explorations'))
      .map((v) => explorationSchema.parse(v))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id: string) {
    const row = await readRecord<unknown>('explorations', id);
    if (!row) return null;
    const p = explorationSchema.parse(row);
    p.questions = reconcileDecisions(p.questions, p.id);
    return p;
  },
  async save(project: Exploration) {
    await mutateProject(project.id, (stored) => validateProjectSave(project, stored));
  },
  async setTrashed(id: string, expectedRevision: number, trashed: boolean) {
    const project = await mutateProject(id, (stored) => {
      if (!stored) throw new Error('探索不存在，未修改其他项目。');
      return changeProjectTrash(stored, expectedRevision, trashed);
    });
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(PROJECT_LIFECYCLE_CHANNEL);
      channel.postMessage({ id });
      channel.close();
    }
    return project;
  },
  async asset(id: string) {
    return readRecord<Asset | undefined>('exploration-assets', id);
  },
  async saveAsset(asset: Asset) {
    await writeRecords([{ store: 'exploration-assets', value: asset }]);
  },
  async import(project: Exploration, assets: Asset[]) {
    await writeRecords([
      { store: 'explorations', value: explorationSchema.parse(project) },
      ...assets.map((value) => ({ store: 'exploration-assets' as const, value })),
    ]);
  },
  async snapshots() {
    return (await this.list())
      .flatMap((project) => project.snapshots.map((snapshot) => ({ project, snapshot })))
      .sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt));
  },
  async recordTransfer(projectId: string, event: NonNullable<Exploration['transfers']>[number]) {
    const p = await this.get(projectId);
    if (!p) return;
    p.transfers = [...(p.transfers ?? []), event];
    p.revision++;
    p.updatedAt = timestamp();
    await this.save(p);
  },
  // 删除前检查其他草稿、快照及岗位导入链；只有无人引用的附件才在同一事务清理。
  async deleteSnapshot(projectId: string, snapshotId: string) {
    const db = await database();
    return new Promise<{ deletedAssets: number }>((resolve, reject) => {
      const tx = db.transaction(['explorations', 'exploration-assets', 'workspaces'], 'readwrite');
      const getAll = <T>(name: string) =>
        new Promise<T[]>((done, fail) => {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => done(request.result as T[]);
          request.onerror = () => fail(new Error('删除前引用检查失败'));
        });
      let deletedAssets = 0;
      void Promise.all([getAll<unknown>('explorations'), getAll<unknown>('workspaces')])
        .then(([projects, workspaces]) => {
          const parsed = projects.map((p) => explorationSchema.parse(p));
          const owner = parsed.find((p) => p.id === projectId);
          const snapshot = owner?.snapshots.find((s) => s.snapshotId === snapshotId);
          if (!owner || !snapshot) throw new Error('快照不存在或已经删除。');
          const possible = assetReferences(snapshot);
          owner.snapshots = owner.snapshots.filter((s) => s.snapshotId !== snapshotId);
          owner.exportedSnapshotIds = owner.exportedSnapshotIds.filter((id) => id !== snapshotId);
          owner.revision++;
          owner.updatedAt = timestamp();
          const retained = new Set(
            parsed.flatMap((p) => [p, ...p.snapshots].flatMap((record) => assetReferences(record))),
          );
          for (const raw of workspaces)
            for (const imported of workspaceSchema.parse(raw).researchImports ?? [])
              for (const material of [imported.material, ...(imported.versions ?? [])])
                for (const id of assetReferences({
                  sources: material.sourceRecords,
                  evidence: material.evidenceRecords,
                }))
                  retained.add(id);
          for (const id of possible)
            if (!retained.has(id)) {
              tx.objectStore('exploration-assets').delete(id);
              deletedAssets++;
            }
          tx.objectStore('explorations').put(owner);
        })
        .catch((error) => {
          tx.abort();
          reject(error);
        });
      tx.oncomplete = () => resolve({ deletedAssets });
      tx.onerror = () => reject(new Error('删除失败，事务未完成'));
      tx.onabort = () => reject(new Error('删除已中止，原记录保留。'));
    });
  },
};
