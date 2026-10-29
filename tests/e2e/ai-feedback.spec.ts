import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { newWorkspace, newItem, now, fields } from '../../src/lib/workbench/model';
import { emptyAI, type AIRequest } from '../../src/lib/workbench/ai-contract';
import { seedLegacyLab } from '../fixtures/legacy-browser';
import type { Exploration } from '../../src/lib/exploration/model';
import { mockFeatures, mockLinks, mockRoles } from '../../src/lib/lab/mock';
import type { LabStageRequest } from '../../src/lib/lab/ai-contract';
const shots = 'docs/screenshots/ai-feedback';
async function savedRecord<T>(page: Page, store: string): Promise<T> {
  return page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jd-assistant-workbench', 3);
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<T>((resolve) => {
      const r = db.transaction(store).objectStore(store).get(location.pathname.split('/').at(-1)!);
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
    });
  }, store);
}
async function workspace(page: Page) {
  await page.goto('/');
  const w = newWorkspace('软件工程师 · 反馈回归（虚构）');
  const t = newItem('task', '界面交付', '完成测试页面与验收。');
  t.status = 'confirmed';
  const r = newItem('requirement', '界面实现能力', '能完成相关页面交付。');
  r.status = 'confirmed';
  r.taskIds = [t.id];
  t.requirementIds = [r.id];
  w.items = [t, r];
  w.ui.selectedId = t.id;
  w.sources = [
    {
      id: 's',
      title: '固定验收资料（虚构）',
      type: 'project',
      person: '本地合成样例',
      createdAt: now(),
      removed: false,
      versions: [
        {
          revision: 1,
          text: '本岗位完成测试页面与验收，能力要求为相关界面实现。',
          createdAt: now(),
        },
      ],
    },
  ];
  await page.evaluate(async (w) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
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
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('workspaces', 'readwrite');
      tx.objectStore('workspaces').put(w);
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, w);
  await page.goto(`/workspaces/${w.id}`);
  const guide = page.getByRole('complementary', { name: '岗位交互教程' });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: '跳过教程', exact: true }).click();
  return w;
}
test('当前任务按钮对比度、顶部操作栏四视口、AI处理中与完成/格式错误反馈', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w = await workspace(page);
  const generate = page.getByRole('button', { name: '生成 JD 草稿', exact: true });
  await expect(generate).toHaveClass(/current-business-action/);
  expect(await generate.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(24, 61, 49)');
  await mkdir(shots, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `${shots}/workbench-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let suggestCalls = 0;
  await page.route('**/api/workbench', async (route) => {
    const req = route.request().postDataJSON() as AIRequest;
    const data = emptyAI();
    if (req.action === 'draft') {
      await pending;
      data.blocks = [
        {
          title: '主要职责',
          text: '- 完成测试页面与验收。',
          taskIds: [w.items[0].id],
          requirementIds: [],
          refs: [],
        },
      ];
    } else {
      suggestCalls++;
      if (suggestCalls === 1) {
        await route.fulfill({
          status: 422,
          json: {
            error: '模型结果未通过结构校验；已有编辑保留。',
            code: 'INVALID_FORMAT',
            requestId: 'fixed-format-case',
            validationIssues: [
              {
                code: 'SCHEMA_INVALID_TYPE',
                path: 'groups[0].changes[0].before',
                message: 'before缺少完整字段。',
              },
            ],
          },
        });
        return;
      }
      const target = req.context.items.find((i) => i.id === req.targetId)!;
      data.groups = [
        {
          reason: '固定接口边界验收，非真实AI推理',
          changes: [
            {
              targetId: target.id,
              operation: 'update',
              after: { ...fields(target), text: '- 完成页面并记录验收结果。' },
              reason: '仅精简选中段落',
              refs: [],
            },
          ],
        },
      ];
    }
    await route.fulfill({
      json: {
        workspaceId: req.context.id,
        baseRevision: req.context.revision,
        requestId: `fixed-${req.action}-${suggestCalls}`,
        task: req.action === 'draft' ? 'generateJdDraft' : 'proposeLocalChanges',
        promptVersion: 'test@1',
        data,
      },
    });
  });
  await generate.click();
  const status = page.getByTestId('workbench-ai-status');
  await expect(status).toContainText('正在生成JD草稿');
  await expect(generate).toBeDisabled();
  await expect(status.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await page.screenshot({ path: `${shots}/loading.png`, fullPage: true });
  release();
  await expect(status).toContainText('JD草稿已生成');
  const body = page.getByLabel('主要职责正文', { exact: true });
  await expect(body).toHaveValue('- 完成测试页面与验收。');
  await body.focus();
  await page
    .getByLabel('这一次，你想调整什么？', { exact: true })
    .fill('精简当前段落，保留验收要求。');
  await page.getByRole('button', { name: '生成局部修改建议', exact: true }).click();
  await expect(status).toContainText('未完成');
  await expect(page.locator('.center-ai-error')).toContainText('groups[0].changes[0].before');
  await expect(body).toHaveValue('- 完成测试页面与验收。');
  await expect(page.getByLabel('这一次，你想调整什么？', { exact: true })).toHaveValue(
    '精简当前段落，保留验收要求。',
  );
  await page
    .locator('.center-ai-error')
    .getByRole('button', { name: '重试本次操作', exact: true })
    .click();
  await expect(status).toContainText('局部建议已生成');
  await expect(page.getByTestId('suggestion-card')).toHaveCount(1);
  await expect(body).toHaveValue('- 完成测试页面与验收。');
  await page.screenshot({ path: `${shots}/completed.png`, fullPage: true });
});
test('图片原文入口识图、无坐标转写校对为证据，再由实际关联按钮发送', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedLegacyLab(page);
  await page
    .locator('.lab-top-actions')
    .getByRole('button', { name: '查看完整证据板', exact: true })
    .click();
  await page.getByRole('button', { name: '更多研究操作', exact: true }).click();
  await page
    .getByRole('navigation', { name: '研究操作' })
    .getByRole('button', { name: '资料与关系列表', exact: true })
    .click();
  const list = page.getByRole('dialog', { name: '资料与关系列表' });
  await list
    .locator('.lab-history-row')
    .filter({ hasText: '演示设计工具界面' })
    .getByRole('button', { name: '查看原文', exact: true })
    .click();
  await page.getByRole('button', { name: '识别图片文字与画面', exact: true }).click();
  await page.route('**/api/lab/image-evidence', async (route) => {
    const req = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...req,
        requestId: 'fixed-image-case',
        promptVersion: 'test-vision@1',
        output: {
          text: '验收模拟转写：Export导出当前项目。',
          regions: [],
          limitations: ['模拟返回无可靠行坐标，需对照原图核对；不是本轮真实识图。'],
        },
      },
    });
  });
  const dialog = page.getByRole('dialog', { name: /区域标注 ·/ });
  await dialog.getByRole('button', { name: '提取图像文字与标注候选', exact: true }).click();
  await expect(dialog.getByText(/识图已完成/)).toBeVisible();
  await expect(dialog.getByLabel('核对后的图片文字或说明')).toHaveValue(
    '验收模拟转写：Export导出当前项目。',
  );
  await dialog.getByLabel('核对后的图片文字或说明').fill('人工核对验收：Export入口导出当前项目。');
  await dialog.getByRole('button', { name: '已核对，保存整图文字证据', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '已保存为证据', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${shots}/image-text-evidence.png`, fullPage: true });
  await page.keyboard.press('Escape');
  let imageEvidenceReceived = false;
  await page.route('**/api/lab/*', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const req = route.request().postDataJSON() as LabStageRequest;
    imageEvidenceReceived ||= req.analysis.evidence.some(
      (e) => e.excerpt === '人工核对验收：Export入口导出当前项目。',
    );
    const output =
      req.stage === 'derive_features'
        ? mockFeatures(req)
        : req.stage === 'link_evidence'
          ? mockLinks(req)
          : mockRoles(req);
    await route.fulfill({
      json: {
        projectId: req.projectId,
        baseRevision: req.revision,
        inputVersions: req.inputVersions,
        stage: req.stage,
        output,
        requestId: `test-${req.stage}`,
        mode: req.mode,
        promptVersion: 'test@1',
        modelConfig: { configurationId: 'test' },
      },
    });
  });
  await page.getByRole('button', { name: '关联分析', exact: true }).click();
  await expect.poll(() => imageEvidenceReceived).toBe(true);
  await expect(page.locator('.lab-project-heading [role=status]')).toContainText('已保存');
  const p = await savedRecord<Exploration>(page, 'explorations');
  expect(
    p.evidence.some(
      (e) =>
        e.excerpt === '人工核对验收：Export入口导出当前项目。' &&
        e.location.kind === 'image' &&
        e.verificationStatus === 'verified',
    ),
  ).toBe(true);
});
