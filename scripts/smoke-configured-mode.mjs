import { chromium, expect } from '@playwright/test';
const base = new URL(process.env.LOCAL_MODE_BASE_URL ?? 'http://127.0.0.1:3004');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('仅允许本机配置冒烟检查。');
const response = await fetch(new URL('/api/status', base));
if (!response.ok) throw new Error(`本机公开配置读取失败：HTTP ${response.status}`);
const status = await response.json();
if (!['mock', 'real'].includes(status.mode)) throw new Error('公开模式不合法。');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(),
    posts = [],
    errors = [];
  page.setDefaultTimeout(25000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => {
    // This smoke check cannot submit a model request, even against a real-mode server.
    if (route.request().method() === 'POST') {
      posts.push(new URL(route.request().url()).pathname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(base.href);
  await page.getByRole('button', { name: '创建岗位', exact: true }).first().click();
  await page.getByLabel('岗位名称', { exact: true }).fill('配置读取验收软件工程师');
  await page.getByRole('button', { name: '创建并进入', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换AI协作方式' })).toContainText(
    status.mode === 'real' ? '真实AI模式' : '示例演示',
    { timeout: 25000 },
  );
  if (posts.length || errors.length) throw new Error(JSON.stringify({ posts, errors }));
  console.log(
    JSON.stringify({
      result: 'pass',
      publicMode: status.mode,
      newWorkspaceMode: status.mode === 'real' ? 'real' : 'example',
      modelPosts: posts.length,
      pageErrors: errors.length,
      browser: browser.version(),
      storage: 'temporary browser context',
    }),
  );
} finally {
  await browser.close();
}
