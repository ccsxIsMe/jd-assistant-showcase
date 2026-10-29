import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { newExploration, explorationSchema, makeId } from '../../src/lib/exploration/model';
import { changeProjectTrash, validateProjectSave } from '../../src/lib/exploration/lifecycle';
import { softwareTextProject, completeSoftwareResearch } from '../../src/lib/demo/software';
import { modelError } from '../../src/lib/ai/errors';
import { APICallError } from 'ai';
import { probeAiNetwork } from '../../src/lib/ai/network-probe';
import { GET } from '../../src/app/api/ai/network/route';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('旧项目无回收站字段仍兼容，非法时间被拒绝', () => {
  const p = newExploration('旧项目');
  expect(explorationSchema.parse(p).trashedAt).toBeUndefined();
  expect(explorationSchema.safeParse({ ...p, trashedAt: 'invalid' }).success).toBe(false);
});
it('删除与恢复保留全部快照和附件引用，停止未结束阶段', () => {
  const p = completeSoftwareResearch(
    softwareTextProject({
      fixture: 'software-engineer',
      version: 1,
      instanceId: makeId(),
      kind: 'demo',
      seed: 'complete',
    }),
    new Set(),
  );
  p.lab!.runs.at(-1)!.status = 'running';
  const before = structuredClone(p),
    removed = changeProjectTrash(p, p.revision, true);
  expect(p).toEqual(before);
  expect(removed.snapshots).toEqual(p.snapshots);
  expect(removed.sources).toEqual(p.sources);
  expect(removed.evidence).toEqual(p.evidence);
  expect(removed.lab!.runs.at(-1)).toMatchObject({
    status: 'cancelled',
    errorCode: 'PROJECT_TRASHED',
  });
  const restored = changeProjectTrash(removed, removed.revision, false);
  expect(restored.trashedAt).toBeNull();
  expect(restored.revision).toBe(p.revision + 2);
  expect(restored.snapshots).toEqual(p.snapshots);
  expect(restored.lab!.requirements).toEqual(p.lab!.requirements);
});
it('版本冲突、重复删除与迟到保存均拒绝，恢复后旧版本也不能覆盖', () => {
  const p = newExploration('并发项目'),
    removed = changeProjectTrash(p, p.revision, true);
  expect(() => changeProjectTrash(p, p.revision + 1, true)).toThrow('其他页面更新');
  expect(() => changeProjectTrash(removed, removed.revision, true)).toThrow('已经在回收站');
  expect(() => validateProjectSave(p, removed)).toThrow('回收站');
  const restored = changeProjectTrash(removed, removed.revision, false);
  expect(() => validateProjectSave(p, restored)).toThrow('更新版本');
  expect(validateProjectSave(restored, restored)).toEqual(restored);
});
it.each(['EACCES', 'EPERM'])('嵌套%s归类为进程联网受限，不误报密钥或余额', (code) => {
  const cause = Object.assign(new Error('private-detail'), { code });
  const error = new APICallError({
    message: 'private-key',
    url: 'https://example.invalid',
    requestBodyValues: { secret: 'private-body' },
    cause: new AggregateError([cause], 'private-message'),
  });
  const safe = modelError(error);
  expect(safe).toMatchObject({ code: 'NETWORK_DENIED', status: 502 });
  expect(safe.message).toContain(code);
  expect(JSON.stringify(safe)).not.toContain('private-');
});
it('证书错误不降级关闭SSL，未知错误不输出原文', () => {
  expect(modelError(new Error('secret', { cause: { code: 'CERT_HAS_EXPIRED' } }))).toMatchObject({
    code: 'TLS_ERROR',
  });
  expect(
    modelError(new Error('secret', { cause: { code: 'unknown-private-code' } })).message,
  ).not.toContain('secret');
});
it('网络探测只访问配置的models地址，无Authorization且401不误判密钥无效', async () => {
  vi.stubEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');
  vi.stubEnv('DEEPSEEK_API_KEY', 'unit-private-key');
  const fetcher = vi.fn().mockResolvedValue(new Response('private-body', { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  const result = await probeAiNetwork(new AbortController().signal);
  expect(result).toMatchObject({ ok: true, httpStatus: 401 });
  expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/models');
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('unit-private-key');
  expect(JSON.stringify(result)).not.toContain('private-body');
});
it('网络诊断路由只返回安全码，不接收任意目标或泄漏原始请求', async () => {
  vi.stubEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('private-request', { cause: { code: 'EACCES' } })),
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await GET(new Request('http://localhost/api/ai/network?url=http://127.0.0.1/private'));
  expect(r.status).toBe(502);
  const result = await r.json();
  expect(result.code).toBe('NETWORK_DENIED');
  expect(result.requestId).toBeTruthy();
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private-request');
});
