import type { Page } from '@playwright/test';
import { newExploration } from '../../src/lib/exploration/model';
import { ideaSource } from '../../src/lib/exploration/sources';
import { textEvidence } from '../../src/lib/exploration/domain';
export async function seedLegacyClassic(page: Page) {
  const p = newExploration('轻量产品原型工具 · 虚构探索');
  const text =
    '我想为小团队制作一个轻量原型工具，面向产品经理和设计师。希望编辑内容时能实时预览，支持导出文件，先做电脑端。\n不需要支付、用户社区和复杂会员体系。\n预算和技术栈尚未确定，需要先确认协作是否为第一阶段必须功能。';
  p.initialObjective = text;
  const s = ideaSource('用户目标与边界', text);
  p.sources.push(s);
  p.evidence.push(...textEvidence(s, s.versions[0]));
  p.ui.sourceId = s.id;
  p.ui.view = 'evidence';
  await page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onupgradeneeded = () => {
        for (const n of [
          'workspaces',
          'explorations',
          'exploration-assets',
          'resume-reviews',
          'demo-instances',
        ])
          if (!r.result.objectStoreNames.contains(n))
            r.result.createObjectStore(n, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('fixture open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('explorations', 'readwrite');
      tx.objectStore('explorations').put(p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('fixture save failed'));
    });
    db.close();
  }, p);
  await page.goto(new URL(`/explore/${p.id}`, page.url()).href);
}
