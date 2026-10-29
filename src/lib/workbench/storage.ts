import { workspaceSchema, type Workspace } from './model';
import { readRecord, writeRecords } from '../storage/database';
import { reconcileDecisions } from '../decisions/records';
export const workspaceStore = {
  async list() {
    const rows = await readRecord<unknown[]>('workspaces');
    return rows
      .map((row) => {
        const w = workspaceSchema.parse(row);
        w.questions = reconcileDecisions(w.questions, w.id);
        return w;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async get(id: string) {
    const row = await readRecord<unknown>('workspaces', id);
    if (!row) return null;
    const w = workspaceSchema.parse(row);
    w.questions = reconcileDecisions(w.questions, w.id);
    return w;
  },
  async save(workspace: Workspace) {
    await writeRecords([{ store: 'workspaces', value: workspaceSchema.parse(workspace) }]);
  },
};
