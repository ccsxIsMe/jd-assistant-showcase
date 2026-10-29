import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3004';
const phase = process.env.AUDIT_PHASE ?? 'after';
console.log('Starting non-billing decision UI audit');
const { project: p } = JSON.parse(await readFile('tests/fixtures/legacy-design-tool.json', 'utf8'));
p.mode = 'example';
p.lab.ui.researchMode = 'plan';
p.lab.ui.planningScreen = 'results';
p.lab.ui.researchView = 'guided';
p.lab.ui.researchStep = 'evidence';
p.questions = [
  {
    id: 'audit-decision',
    title: '首版是否需要实时协作？',
    detail: '固定无敏感验收问题；需要比较首版交付范围。',
    findingIds: p.findings.slice(0, 1).map((f) => f.id),
    evidenceIds: p.evidence.slice(0, 2).map((e) => e.evidenceId),
    status: 'open',
    answer: '',
    choices: [
      { id: 'now', label: '首版支持共同编辑', impact: '需要核对协作与同步的验收边界' },
      { id: 'later', label: '首版先不做共同编辑', impact: '先验证单人编辑，协作留待后续评估' },
    ],
  },
];
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
let blocked = 0;
const results = [];
await page.route('**/api/**', async (route) => {
  if (route.request().method() === 'POST') {
    blocked++;
    await route.abort();
  } else await route.continue();
});
try {
  await page.goto(base + '/lab');
  await page.getByRole('button', { name: '新建探索', exact: true }).waitFor();
  await page.evaluate(async (p) => {
    for (const scope of ['lab', 'workbench'])
      localStorage.setItem(
        `jd-interactive-guide:${scope}:v2`,
        JSON.stringify({ status: 'skipped', stepId: '' }),
      );
    const db = await new Promise((resolve, reject) => {
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
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('explorations', 'readwrite');
      tx.objectStore('explorations').put(p);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, p);
  await page.goto(base + '/lab/' + p.id);
  await page.getByRole('main', { name: 'AI帮我规划' }).waitFor();
  const proof = page.locator('.planning-proof');
  await proof.locator(':scope>summary').click();
  results.push({
    view: 'planning',
    evidenceAnswerForms: await proof.locator('.decision-input').count(),
    planningAnswerForms: await page.locator('.planning-decisions .decision-input').count(),
    allMountedAnswerForms: await page.locator('.decision-input').count(),
  });
  await mkdir('docs/screenshots/unify-decisions', { recursive: true });
  await page.screenshot({
    path: `docs/screenshots/unify-decisions/${phase}-planning.png`,
    fullPage: true,
  });
  await page.getByLabel('研究方式', { exact: true }).selectOption('collaborate');
  await page
    .getByRole('navigation', { name: '研究阶段' })
    .getByRole('button', { name: /确认证据/ })
    .click();
  const q = page.getByTestId('guided-question').first();
  const explanation = q.locator(':scope>details').first();
  if ((await explanation.getAttribute('open')) === null)
    await explanation.locator(':scope>summary').click();
  await q.screenshot({ path: `docs/screenshots/unify-decisions/${phase}-answer-card.png` });
  results.push({
    view: 'collaborate',
    choiceFormsPerQuestion: await q.locator('.decision-input').count(),
    legacyAnswerTextareasPerQuestion: await q.locator('textarea[aria-label^="问题回答："]').count(),
    allMountedAnswerForms: await page.locator('.decision-input').count(),
  });
  await page.screenshot({
    path: `docs/screenshots/unify-decisions/${phase}-collaborate.png`,
    fullPage: true,
  });
  await writeFile(
    `docs/unified-decision-${phase}.json`,
    JSON.stringify({ phase, results, blockedPosts: blocked }, null, 2),
  );
  console.log(JSON.stringify({ phase, results, blockedPosts: blocked }));
} finally {
  await browser.close();
}
