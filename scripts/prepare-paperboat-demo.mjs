import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { Document, Packer, Paragraph } from 'docx';
import mammoth from 'mammoth';
import {
  SOFTWARE_OBJECTIVE,
  SOFTWARE_SOURCES,
  SOFTWARE_RESUME_LINES,
} from '../src/lib/demo/software-content.ts';
import { format, resolveConfig } from 'prettier';
import {
  PAPERBOAT_OBJECTIVE,
  PAPERBOAT_SOURCES,
  PAPERBOAT_RESUME_LINES,
} from '../src/lib/demo/paperboat-content.ts';
const software = process.argv.includes('--software'),
  folder = software ? 'public/demo/software-engineer' : 'public/demo/paperboat';
const objective = software ? SOFTWARE_OBJECTIVE : PAPERBOAT_OBJECTIVE,
  sources = software ? SOFTWARE_SOURCES : PAPERBOAT_SOURCES,
  resumeLines = software ? SOFTWARE_RESUME_LINES : PAPERBOAT_RESUME_LINES;
await mkdir(folder, { recursive: true });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>纸舟活动 · 本地模拟参考产品</title><style>*{box-sizing:border-box}body{margin:0;background:#f0f5f5;color:#203b45;font:16px 'Microsoft YaHei',sans-serif}nav{height:64px;background:#0a1726;color:#c3e6dc;display:flex;justify-content:space-between;padding:0 38px;align-items:center}nav a{color:inherit;margin-left:20px;text-decoration:none}header{padding:28px 38px 20px}small{font-size:12px;color:#637f82}h1{font-size:29px;margin:12px 0}p{line-height:1.8}.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;padding:0 38px 24px}.card{background:white;border:1px solid #d3e2de;padding:23px;border-radius:12px}.tag{font-size:12px;color:#31745f}h2{font-size:20px;margin:8px 0 12px}.pill{display:inline-block;padding:9px 16px;background:#bdf0de;border-radius:6px;margin:4px 8px 4px 0;color:#194d3b;text-decoration:none}.row{border-top:1px solid #e5ece9;padding:13px 0;font-size:14px}footer{padding:18px 38px;border-top:1px solid #d8e6e1;color:#607b81;font-size:12px}section{scroll-margin:20px}@media(max-width:650px){.grid{grid-template-columns:1fr}nav{padding:0 20px}header{padding:20px}.grid{padding:0 20px 20px}}</style><nav><b>纸舟活动 / PAPERBOAT</b><span><a href="#features">功能说明</a><a href="#export">文件导出</a></span></nav><header><small>本地模拟产品 · 虚构材料 · 非真实在线抓取</small><h1>让小型活动，有序发生。</h1><p>界面示意资料，用于核对真实区域与功能边界，不是已上线的报名系统。</p></header><main class="grid" id="features"><section class="card" id="signup"><span class="tag">用户侧 / 活动浏览与报名</span><h2>周末城市散步 · 模拟活动</h2><p>2026年11月 · 城市公共空间<br>查看时间、地点与说明后填写报名表单。</p><div data-region="signup"><a class="pill" href="#capacity">查看报名与名额规则</a></div><div class="row">姓名、参与人数与备注 · 字段范围待确认</div><div class="row" id="capacity" data-region="capacity">名额状态：剩余20个（演示数字）<br>满额后关闭还是候补，由用户决定。</div></section><section class="card" id="export"><span class="tag">运营侧 / 名单查看</span><h2>活动名单 · 界面示意</h2><div data-region="export"><a class="pill" href="#export-note">CSV导出说明</a></div><div class="row">演示报名001 · 已登记</div><div class="row">演示报名002 · 待核对</div><p id="export-note">筛选名单并导出CSV。字段与权限必须先确认。</p><small>参考产品展示支付、积分、聊天，不代表纸舟首版需要。</small></section></main><footer>这是可打开的本地模拟网页。顶部导航和页脚不是独立产品需求；未接入支付、聊天或真实报名服务。</footer></html>`;
const formatting = await resolveConfig('package.json');
let documentHTML = html;
if (software) {
  for (const [from, to] of [
    ['纸舟活动', '星桥软件'],
    ['PAPERBOAT', 'ISSUE TRACKER'],
    ['让小型活动，有序发生。', '让问题跟踪，清晰可验。'],
    ['不是已上线的报名系统', '不是已上线的问题追踪系统'],
    ['未接入支付、聊天或真实报名服务', '未接入真实接口、数据库或身份认证服务'],
    ['用户侧 / 活动浏览与报名', '工程侧 / 问题创建与跟踪'],
    ['周末城市散步 · 模拟活动', '问题追踪系统 · 模拟页面'],
    ['2026年11月 · 城市公共空间', '演示技术选择 · React / TypeScript'],
    ['查看时间、地点与说明后填写报名表单。', '创建问题、更新状态、搜索并导出列表。'],
    ['查看报名与名额规则', '创建问题与状态规则'],
    ['姓名、参与人数与备注 · 字段范围待确认', '标题、描述和优先级 · 表单字段待确认'],
    ['名额状态：剩余20个（演示数字）', '问题状态：待处理（模拟记录）'],
    ['满额后关闭还是候补，由用户决定。', '谁可修改状态，由负责人确认。'],
    ['运营侧 / 名单查看', '协作侧 / 问题列表'],
    ['活动名单 · 界面示意', '问题列表 · 界面示意'],
    ['演示报名001 · 已登记', 'ISSUE-001 · 待处理'],
    ['演示报名002 · 待核对', 'ISSUE-002 · 处理中'],
    ['筛选名单并导出CSV。字段与权限必须先确认。', '筛选问题并导出CSV；接口、SQL和权限需要验收。'],
    [
      '参考产品展示支付、积分、聊天，不代表纸舟首版需要。',
      '参考产品展示复杂审批和AI插件，不代表本项目首版需要。',
    ],
  ])
    documentHTML = documentHTML.replaceAll(from, to);
}
const renderedHTML = await format(documentHTML, { ...formatting, parser: 'html' });
await writeFile(`${folder}/reference.html`, renderedHTML);
const brief = [
  ...sources.filter((s) => s.kind === 'text').flatMap((s) => [s.title, ...s.text.split('\n')]),
];
for (const [name, lines] of [
  [software ? 'software-brief.docx' : 'paperboat-brief.docx', brief],
  [software ? 'software-resume.docx' : 'paperboat-resume.docx', resumeLines],
]) {
  const buffer = await Packer.toBuffer(
    new Document({ sections: [{ children: lines.map((line) => new Paragraph(line)) }] }),
  );
  await writeFile(`${folder}/${name}`, buffer);
  const parsed = await mammoth.extractRawText({ buffer });
  for (const line of lines)
    if (!parsed.value.includes(line)) throw new Error(`DOCX verification failed: ${name}`);
}
await writeFile(`${folder}/resume.txt`, resumeLines.join('\n'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let regions;
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 720 },
    deviceScaleFactor: 1,
  });
  await page.setContent(renderedHTML);
  regions = await page.locator('[data-region]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        key: el.getAttribute('data-region'),
        x: r.x / 1000,
        y: r.y / 720,
        width: r.width / 1000,
        height: r.height / 720,
      };
    }),
  );
  await page.screenshot({ path: `${folder}/interface.png` });
} finally {
  await browser.close();
}
const files = [];
for (const name of [
  'reference.html',
  software ? 'software-brief.docx' : 'paperboat-brief.docx',
  software ? 'software-resume.docx' : 'paperboat-resume.docx',
  'resume.txt',
  'interface.png',
]) {
  const bytes = await readFile(`${folder}/${name}`);
  files.push({
    name,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
await writeFile(
  `${folder}/manifest.json`,
  await format(
    JSON.stringify(
      {
        fixture: software ? 'software-engineer' : 'paperboat',
        version: 1,
        notice: '示例项目｜虚构材料｜预置分析结果',
        objective,
        files,
        image: { width: 1000, height: 720, regions },
        capabilities: {
          web: '内部可信静态资源，不经过任意URL抓取',
          document: 'DOCX已用Mammoth实际解析核对',
          image: '程序生成的已知区域，不声称视觉模型识别',
        },
      },
      null,
      2,
    ),
    { ...formatting, parser: 'json' },
  ),
);
console.log(
  `${software ? 'Software engineer' : 'Paperboat'} v1: 5 synthetic source files generated; DOCX content and real screenshot regions verified. No model calls.`,
);
