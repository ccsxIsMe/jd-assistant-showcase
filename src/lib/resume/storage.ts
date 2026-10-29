import { readRecord, writeRecords, database } from '../storage/database';
import { type ReviewSession } from './model';
import { validateReviewSession } from './domain';
export const resumeStore = {
  async summaries() {
    const db = await database();
    return new Promise<{ id: string; title: string; updatedAt: string; reports: number }[]>(
      (resolve, reject) => {
        const rows: { id: string; title: string; updatedAt: string; reports: number }[] = [];
        const r = db.transaction('resume-reviews').objectStore('resume-reviews').openCursor();
        r.onsuccess = () => {
          const c = r.result;
          if (!c) {
            resolve(rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
            return;
          }
          const v = c.value as ReviewSession;
          rows.push({
            id: v.id,
            title: v.title,
            updatedAt: v.updatedAt,
            reports: v.reports?.length ?? 0,
          });
          c.continue();
        };
        r.onerror = () => reject(new Error('核对历史读取失败，原记录保留。'));
      },
    );
  },
  async get(id: string) {
    const s = await readRecord<unknown>('resume-reviews', id);
    return s ? validateReviewSession(s) : null;
  },
  async save(s: ReviewSession) {
    await writeRecords([{ store: 'resume-reviews', value: validateReviewSession(s) }]);
  },
  async remove(id: string) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('resume-reviews', 'readwrite');
      tx.objectStore('resume-reviews').delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('删除失败，原材料保留。'));
    });
  },
};
