// Setup fixtures only. Assertions and all subsequent interactions use real pages.
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createExample } from '../../src/lib/workbench/example';
import { createCompletedExample } from '../../src/lib/workbench/completed-example';
export async function seedLegacyWorkbench(page: Page, completed = false) {
  if (page.url() === 'about:blank') await page.goto('/');
  const w = completed ? createCompletedExample() : createExample();
  await page.evaluate(async (w) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onupgradeneeded = () => {
        for (const name of [
          'workspaces',
          'explorations',
          'exploration-assets',
          'resume-reviews',
          'demo-instances',
        ])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('fixture open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspaces', 'readwrite');
      tx.objectStore('workspaces').put(w);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('fixture save failed'));
    });
    db.close();
  }, w);
  await page.goto(new URL(`/workspaces/${w.id}`, page.url()).href);
}
export async function seedLegacyLab(page: Page) {
  const fixture = JSON.parse(
    await readFile(new URL('./legacy-design-tool.json', import.meta.url), 'utf8'),
  );
  if (page.url() === 'about:blank') await page.goto('/lab');
  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onupgradeneeded = () => {
        for (const name of [
          'workspaces',
          'explorations',
          'exploration-assets',
          'resume-reviews',
          'demo-instances',
        ])
          if (!r.result.objectStoreNames.contains(name))
            r.result.createObjectStore(name, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('fixture open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['explorations', 'exploration-assets'], 'readwrite');
      tx.objectStore('explorations').put(data.project);
      for (const a of data.assets) {
        const binary = atob(a.base64),
          bytes = Uint8Array.from(binary, (s) => s.charCodeAt(0));
        tx.objectStore('exploration-assets').put({
          id: a.id,
          explorationId: a.explorationId,
          name: a.name,
          blob: new Blob([bytes], { type: a.mime }),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('fixture save failed'));
    });
    db.close();
  }, fixture);
  await page.goto(new URL(`/lab/${fixture.project.id}`, page.url()).href);
}
