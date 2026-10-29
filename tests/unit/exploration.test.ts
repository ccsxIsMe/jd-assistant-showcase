import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  createSource,
  sourceChanged,
  paragraphs,
  evidenceValid,
  semanticSignature,
  applyAnalysis,
  createSnapshot,
  changeFinding,
  compareSnapshots,
  validateAnalysis,
  snapshotMarkdown,
  removeSource,
} from '../../src/lib/exploration/domain';
import { newExploration, rectangleSchema, type AnalysisRun } from '../../src/lib/exploration/model';
import {
  analysisRequestFor,
  exampleAnalysis,
  analysisRequestSchema,
} from '../../src/lib/exploration/analysis';
import { snapshotSources } from '../../src/lib/exploration/jd-import';
import { validateMaterial, validateSignature } from '../../src/lib/exploration/files';
import { parsePackage } from '../../src/lib/exploration/portable';
import {
  fetchPublicPage,
  publicAddress,
  normalizePublicURL,
  extractHTML,
} from '../../src/lib/exploration/web';
import { readBoundedJSON } from '../../src/lib/exploration/http';

function seed() {
  const p = newExploration('虚构原型产品');
  const source = createSource('text', '用户说明');
  source.status = 'ready';
  source.versions[0].text = '希望编辑内容时实时预览并导出文件。\n不需要支付或社区。';
  source.versions[0].paragraphs = paragraphs(source.versions[0].text);
  return sourceChanged(p, source, source.versions[0]);
}
function analyzed() {
  let p = seed();
  const output = exampleAnalysis(analysisRequestFor(p));
  const run: AnalysisRun = {
    id: 'run-test',
    at: '2026-10-24',
    requestId: 'request-test',
    promptVersion: 'exploreRequirements@1.0.0',
    mode: 'example',
    baseSignature: semanticSignature(p),
    output,
    applied: false,
  };
  p.runs.push(run);
  p = applyAnalysis(
    p,
    run,
    output.findings.map((f) => f.key),
    true,
  );
  return p;
}
function confirmed() {
  let p = analyzed();
  p.overviewConfirmed = true;
  for (const f of [...p.findings]) p = changeFinding(p, f.id, { status: 'confirmed' });
  return p;
}

describe('探索证据、人工校验和快照', () => {
  it('无证据概览必须标推断，来源冲突必须有双方，网页观察不冒充用户要求', () => {
    const p = seed();
    const overview = exampleAnalysis(analysisRequestFor(p));
    overview.overview.evidenceIds = [];
    expect(() => validateAnalysis(p, overview)).toThrow('概览');
    overview.overview.inferredFields = ['goal'];
    expect(() => validateAnalysis(p, overview)).not.toThrow();
    const conflict = exampleAnalysis(analysisRequestFor(p));
    conflict.findings[0].kind = 'conflict';
    expect(() => validateAnalysis(p, conflict)).toThrow('双方');
    conflict.findings[0].basis = 'inferred';
    expect(() => validateAnalysis(p, conflict)).not.toThrow();
    const observed = structuredClone(p);
    observed.evidence[0].evidenceType = 'web-text';
    const request = analysisRequestFor(observed);
    const output = exampleAnalysis(request);
    output.findings[0].basis = 'explicit';
    expect(() => validateAnalysis(observed, output)).toThrow('用户文字');
  });
  it('空资料不能分析，未确认状态与模型输出相互独立', () => {
    expect(() => analysisRequestFor(newExploration('空白'))).toThrow();
    const p = analyzed();
    expect(p.findings.length).toBeGreaterThan(0);
    expect(p.findings.every((f) => f.status === 'pending')).toBe(true);
    expect(p.overviewConfirmed).toBe(false);
    expect(() =>
      analysisRequestSchema.parse({ ...analysisRequestFor(seed()), consent: false }),
    ).toThrow();
  });
  it('示例候选符合Schema，保留明确不借鉴的边界与真实原文ID', () => {
    const p = seed();
    const output = validateAnalysis(p, exampleAnalysis(analysisRequestFor(p)));
    expect(output.findings.some((f) => f.basis === 'excluded')).toBe(true);
    expect(
      output.findings.every((f) =>
        f.evidenceIds.every((id) =>
          p.evidence.some((e) => e.evidenceId === id && evidenceValid(p, e)),
        ),
      ),
    ).toBe(true);
  });
  it('伪造证据ID、错误原文位置、未解析来源和结构循环被拒绝', () => {
    const p = seed();
    const raw = exampleAnalysis(analysisRequestFor(p));
    raw.findings[0].evidenceIds = ['invented'];
    expect(() => validateAnalysis(p, raw)).toThrow('引用');
    const e = structuredClone(p.evidence[0]);
    if (e.location.kind === 'text') e.location.start = 1;
    expect(evidenceValid(p, e)).toBe(false);
    const failed = structuredClone(p);
    failed.sources[0].status = 'error';
    expect(evidenceValid(failed, failed.evidence[0])).toBe(false);
    const cycle = exampleAnalysis(analysisRequestFor(p));
    cycle.findings[0].parentKey = cycle.findings[1].key;
    cycle.findings[1].parentKey = cycle.findings[0].key;
    expect(() => validateAnalysis(p, cycle)).toThrow('循环');
  });
  it('来源修订和移除使相关结论需复核，历史快照不变', () => {
    let p = confirmed();
    const frozen = createSnapshot(p, 'confirmed');
    const copy = structuredClone(frozen);
    p.snapshots.push(frozen);
    const source = structuredClone(p.sources[0]);
    const version = {
      ...source.versions[0],
      text: '只做只读预览。',
      paragraphs: paragraphs('只做只读预览。'),
    };
    p = sourceChanged(p, source, version);
    expect(p.findings.some((f) => f.status === 'review')).toBe(true);
    expect(p.snapshots[0]).toEqual(copy);
    expect(p.sources[0].versions).toHaveLength(2);
    expect(evidenceValid(p, p.evidence[0])).toBe(false);
  });
  it('移除来源保留证据并拦截确认，矩形坐标边界明确', () => {
    const original = confirmed();
    const p = removeSource(original, original.sources[0].id);
    expect(p.sources[0].removed).toBe(true);
    expect(p.evidence.length).toBe(original.evidence.length);
    expect(() => changeFinding(p, p.findings[0].id, { status: 'confirmed' })).toThrow('证据');
    expect(rectangleSchema.safeParse({ x: 0.8, y: 0.1, width: 0.4, height: 0.2 }).success).toBe(
      false,
    );
    expect(rectangleSchema.safeParse({ x: 0.1, y: 0.2, width: 0.4, height: 0.3 }).success).toBe(
      true,
    );
  });
  it('模型返回期间人工编辑或锁定后不能覆盖，草案预览不写入', () => {
    const p = seed();
    const output = exampleAnalysis(analysisRequestFor(p));
    const run: AnalysisRun = {
      id: 'r',
      at: '',
      requestId: 'q',
      promptVersion: 'test',
      mode: 'example',
      baseSignature: semanticSignature(p),
      output,
      applied: false,
    };
    const changed = structuredClone(p);
    changed.sources[0].borrow = '人工新增的选择';
    expect(() =>
      applyAnalysis(
        changed,
        run,
        output.findings.map((f) => f.key),
        true,
      ),
    ).toThrow('过期');
    expect(p.findings).toHaveLength(0);
    const existing = analyzed();
    existing.findings[0].locked = true;
    const nextRun = {
      ...run,
      baseSignature: semanticSignature(existing),
      output: exampleAnalysis(analysisRequestFor(existing)),
    };
    expect(() =>
      applyAnalysis(
        existing,
        nextRun,
        nextRun.output.findings.map((f) => f.key),
        false,
      ),
    ).toThrow('锁定');
  });
  it('已确认快照只纳入人工采纳项；导入仅生成来源，不创建岗位对象', () => {
    const p = confirmed();
    const draft = createSnapshot(p, 'draft');
    expect(() => snapshotSources(draft)).toThrow('草案');
    const s = createSnapshot(p, 'confirmed');
    const sources = snapshotSources(s);
    expect(sources.every((s) => s.type === 'project' && s.versions[0].text.length <= 30000)).toBe(
      true,
    );
    expect(sources[0].snapshotOrigin?.snapshotId).toBe(s.snapshotId);
    expect(snapshotMarkdown(s)).toContain('演示数据，非真实AI分析');
    expect(s.findings.some((f) => f.status === 'excluded')).toBe(true);
    p.mode = 'real';
    expect(createSnapshot(p, 'confirmed').mode).toBe('example');
  });
  it('版本比较显示修改/新增，后续编辑不改变旧快照', () => {
    let p = confirmed();
    const first = createSnapshot(p, 'confirmed');
    p.snapshots.push(first);
    p = changeFinding(p, p.findings[0].id, { description: '人工新增验收约束' });
    p = changeFinding(p, p.findings[0].id, { status: 'confirmed' });
    const second = createSnapshot(p, 'confirmed');
    const diff = compareSnapshots(first, second);
    expect(diff.changed).toHaveLength(1);
    expect(first.findings[0].description).not.toBe(second.findings[0].description);
    expect(second.version).toBe(2);
  });
  it('导入包结构与交叉引用校验，原文超过限制拒绝', () => {
    const p = confirmed();
    const data = { format: 'product-exploration-package', version: 1, project: p, assets: [] };
    expect(parsePackage(JSON.stringify(data)).project?.title).toBe(p.title);
    p.findings[0].evidenceIds = ['missing'];
    expect(() => parsePackage(JSON.stringify(data))).toThrow('关联');
    expect(() => paragraphs('a'.repeat(30001))).toThrow('30000');
    expect(paragraphs('小段落\n'.repeat(3000)).length).toBeLessThanOrEqual(120);
  });
});

describe('受控公开网页读取', () => {
  it.each([
    'http://localhost',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'file:///C:/private',
    'https://user:password@example.com',
    'https://example.com:8080',
    'http://a.local',
  ])('阻止危险网址 %s', (url) => {
    expect(() => normalizePublicURL(url)).toThrow();
  });
  it('公有地址校验排除私网、CGNAT、IPv6本地与映射地址', () => {
    for (const ip of [
      '0.0.0.0',
      '100.64.0.1',
      '192.168.1.2',
      '172.16.1.1',
      'fc00::1',
      'fe80::1',
      '::ffff:10.1.1.1',
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('93.184.216.34')).toBe(true);
  });
  it('DNS混入私网即阻止；重定向到元数据地址不发第二个请求', async () => {
    const read = vi.fn().mockResolvedValue({
      status: 302,
      location: 'http://169.254.169.254/latest/meta-data',
      bytes: Buffer.alloc(0),
      contentType: '',
    });
    await expect(
      fetchPublicPage('https://product.example.com', new AbortController().signal, {
        resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        read,
      }),
    ).rejects.toThrow('DNS');
    expect(read).not.toHaveBeenCalled();
    await expect(
      fetchPublicPage('https://product.example.com', new AbortController().signal, {
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
        read,
      }),
    ).rejects.toThrow('禁止');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('实际连接使用已验证IP，限制重定向次数，取消不继续请求', async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const read = vi.fn().mockResolvedValue({
      status: 200,
      contentType: 'text/html;charset=utf-8',
      bytes: Buffer.from(
        '<meta charset="utf-8"><title>产品</title><main><p>真实页面正文支持可定位引用。</p></main>',
      ),
    });
    const result = await fetchPublicPage(
      'https://product.example.com',
      new AbortController().signal,
      { resolve, read },
    );
    expect(result.title).toBe('产品');
    expect(read.mock.calls[0][1].address).toBe('93.184.216.34');
    expect(resolve).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({
      status: 302,
      location: '/next',
      contentType: '',
      bytes: Buffer.alloc(0),
    });
    await expect(
      fetchPublicPage('https://product.example.com', new AbortController().signal, {
        resolve,
        read,
      }),
    ).rejects.toThrow('重定向');
    const controller = new AbortController();
    controller.abort();
    read.mockClear();
    await expect(
      fetchPublicPage('https://product.example.com', controller.signal, { resolve, read }),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('提取标题和正文，脚本/HTML不进入视图，超限响应拒绝', () => {
    const parsed = extractHTML(
      Buffer.from(
        '<html><meta charset="utf-8"><title>公开产品</title><meta name="description" content="介绍"><body><script>steal-secret()</script><nav>导航</nav><main><p>支持实时预览。</p></main></body></html>',
      ),
    );
    expect(parsed.text).toBe('支持实时预览。');
    expect(parsed.description).toBe('介绍');
    expect(parsed.screenshotStatus).toBe('not-available');
    expect(parsed.text).not.toContain('steal');
    expect(() => extractHTML(Buffer.alloc(3 * 1024 * 1024 + 1))).toThrow('3MB');
  });
  it('JSON接口拒绝跨域、错误内容类型和超限请求', async () => {
    await expect(
      readBoundedJSON(
        new Request('http://localhost:3000/api', {
          method: 'POST',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'http://127.0.0.1:3000',
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      ),
    ).resolves.toEqual({});
    await expect(
      readBoundedJSON(
        new Request('http://127.0.0.1/api', {
          method: 'POST',
          headers: { origin: 'https://outside.example', 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    ).rejects.toThrow('本应用');
    await expect(
      readBoundedJSON(new Request('http://127.0.0.1/api', { method: 'POST', body: '{}' })),
    ).rejects.toThrow('JSON');
    await expect(
      readBoundedJSON(
        new Request('http://127.0.0.1/api', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"value":"too much"}',
        }),
        3,
      ),
    ).rejects.toThrow('限制');
  });
});

describe('材料限制与签名', () => {
  it('拒绝空文件、超限、音频、旧doc与伪装文件', async () => {
    for (const file of [
      { name: 'old.doc', type: '', size: 10 },
      { name: 'sound.mp3', type: 'audio/mpeg', size: 10 },
      { name: 'image.svg', type: 'image/svg+xml', size: 10 },
      { name: 'empty.txt', type: 'text/plain', size: 0 },
      { name: 'big.mp4', type: 'video/mp4', size: 31 * 1024 * 1024 },
    ])
      expect(() => validateMaterial(file)).toThrow();
    await expect(validateSignature(new Blob(['not a PNG']), 'image/png')).rejects.toThrow('签名');
    expect(validateMaterial({ name: 'reference.webp', size: 100, type: 'image/webp' }).kind).toBe(
      'image',
    );
  });
});
