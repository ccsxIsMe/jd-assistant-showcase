// 统一数据库仅加法升级；新建缺少的 Store，保留旧岗位、研究和附件记录。
export const stores = [
  'workspaces',
  'explorations',
  'exploration-assets',
  'resume-reviews',
  'demo-instances',
] as const;
export const DATABASE_VERSION = 3;
export type StoreName = (typeof stores)[number];
let connection: Promise<IDBDatabase> | undefined;
export function database() {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('浏览器不支持本地存储，请导出资料后换浏览器。'));
        return;
      }
      const request = indexedDB.open('jd-assistant-workbench', DATABASE_VERSION);
      request.onupgradeneeded = () => {
        for (const name of stores)
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onblocked = () => {
        connection = undefined;
        reject(new Error('数据库升级被旧页面占用。请关闭其他本项目标签页后刷新；原数据未修改。'));
      };
      request.onerror = () => {
        connection = undefined;
        reject(new Error('本地数据库打开失败，请检查浏览器权限。'));
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
    });
  return connection;
}
export async function readRecord<T>(store: StoreName, key?: string): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = key ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(new Error('读取本地资料失败；原始记录保留。'));
  });
}
/** 多 Store 原子写入：事务完成后才能显示“已保存”，单个 put 成功还不算保存成功。 */
export async function writeRecords(entries: { store: StoreName; value: { id: string } }[]) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...new Set(entries.map((e) => e.store))], 'readwrite');
    for (const entry of entries) tx.objectStore(entry.store).put(entry.value);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error('本地保存失败，可能存储空间不足。输入仍在页面，可重试或导出。'));
    tx.onabort = () => reject(new Error('保存被中断，原有记录保留，请重试。'));
  });
}
