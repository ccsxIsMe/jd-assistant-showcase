import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { runWorkbenchAI } from '../../src/lib/ai/workbench-service';
import { generateJdDraft } from '../../src/lib/ai/tasks/generate-jd-draft';
import { proposeLocalChanges } from '../../src/lib/ai/tasks/propose-local-changes';
import { sampleMaterial } from '../../src/lib/ai/tasks/common';
import { ModelError } from '../../src/lib/ai/errors';
import type { AIRequest } from '../../src/lib/workbench/ai-contract';
import { syntheticLab } from '../fixtures/lab';
import { createSource, evidenceValid } from '../../src/lib/exploration/domain';
import { acceptImageTranscription } from '../../src/lib/lab/operations';
import { synchronizeLab } from '../../src/lib/lab/graph';
import { buildLabRequest } from '../../src/lib/lab/workflow';
import { undoResearch } from '../../src/lib/exploration/journal';
import { POST as workbenchPOST } from '../../src/app/api/workbench/route';
beforeEach(() => {
  vi.stubEnv('AI_MODE', 'real');
  vi.stubEnv('DEEPSEEK_API_KEY', 'unit-test-only');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubEnv('DEEPSEEK_BASE_URL', 'https://unit.example');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function response(content: string) {
  return Response.json({
    id: 'test',
    object: 'chat.completion',
    created: 0,
    model: 'deepseek-flash',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}
function request(action: 'draft' | 'suggest'): AIRequest {
  const material = structuredClone(sampleMaterial);
  const context = {
    id: 'fixed-test-workspace',
    revision: 1,
    title: material.title,
    sources: material.sources,
    items: material.items,
    decisions: material.decisions,
    questions: [],
  };
  for (const item of context.items) item.status = 'confirmed';
  return {
    action,
    mode: 'real',
    context,
    intent: '只澄清选中任务的边界，不增加岗位承诺。',
    targetId: action === 'suggest' ? context.items[0].id : null,
  };
}
it.each(['draft', 'suggest'] as const)(
  '真实SDK链路 %s：完整JSON围栏可去除，继续严格校验，不额外收费重试',
  async (action) => {
    const task = action === 'draft' ? generateJdDraft : proposeLocalChanges;
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response('```json\n' + JSON.stringify(task.exampleOutput) + '\n```'));
    const result = await runWorkbenchAI(request(action), new AbortController().signal);
    expect(action === 'draft' ? result.blocks.length : result.groups.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it.each(['draft', 'suggest'] as const)(
  '%s 非法JSON仅修复一次，第二次带具体规则和上次草稿，成功前不写入岗位',
  async (action) => {
    const task = action === 'draft' ? generateJdDraft : proposeLocalChanges;
    const invalid = '{"private-test-material":"unterminated';
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(JSON.stringify(task.exampleOutput)));
    const req = request(action),
      before = structuredClone(req);
    await runWorkbenchAI(req, new AbortController().signal);
    expect(req).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    const input = JSON.parse(
      body.messages.find((m: { role: string }) => m.role === 'user').content,
    );
    expect(input.repair.issues[0]).toMatchObject({ code: 'JSON_SYNTAX', path: 'output' });
    expect(input.repair.previousOutput).toBe(invalid);
  },
);
it('连续非法JSON最多两次，返回安全诊断且错误序列化不包含模型原文', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => response('{"private-test-material":bad'));
  const error = await runWorkbenchAI(request('draft'), new AbortController().signal).catch(
    (e) => e,
  );
  expect(error).toBeInstanceOf(ModelError);
  expect(error).toMatchObject({
    code: 'INVALID_FORMAT',
    attempts: 2,
    validationIssues: [{ code: 'JSON_SYNTAX', path: 'output' }],
  });
  expect(JSON.stringify(error)).not.toContain('private-test-material');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('工作台实际Route返回安全字段诊断和两次上限，不将模型全文写入响应或日志', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response('{"private-test-material":bad'),
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const result = await workbenchPOST(
    new Request('http://local.test/api/workbench', {
      method: 'POST',
      body: JSON.stringify(request('draft')),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const body = await result.json();
  expect(result.status).toBe(422);
  expect(body).toMatchObject({
    code: 'INVALID_FORMAT',
    attempts: 2,
    validationIssues: [{ code: 'JSON_SYNTAX', path: 'output' }],
  });
  expect(typeof body.requestId).toBe('string');
  expect(JSON.stringify(body)).not.toContain('private-test-material');
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private-test-material');
});
it('字段错误的局部建议保留具体路径，围栏不会绕过before或锁定校验', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      response('{"groups":[{"reason":"test","changes":[{"targetId":"task-pages"}]}],"notice":""}'),
    );
  const error = await runWorkbenchAI(request('suggest'), new AbortController().signal).catch(
    (e) => e,
  );
  expect(
    error.validationIssues.some((v: { path: string }) =>
      v.path.includes('groups[0].changes[0].before'),
    ),
  ).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  const req = request('suggest');
  req.context.items[0].locked = true;
  await expect(runWorkbenchAI(req, new AbortController().signal)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('没有内容块不显示JD生成成功', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response('{"blocks":[],"questions":[],"notice":""}'),
  );
  await expect(
    runWorkbenchAI(request('draft'), new AbortController().signal),
  ).rejects.toMatchObject({ code: 'EMPTY_OUTPUT', attempts: 2 });
});
it('带解释或缺失括号不能靠剥除围栏伪装成功', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response('说明如下\n' + JSON.stringify(generateJdDraft.exampleOutput)),
  );
  await expect(
    callDeepSeekJSON({
      schema: generateJdDraft.outputSchema,
      system: 'JSON only',
      input: {},
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'INVALID_FORMAT' });
});
function imageTranscription() {
  let p = syntheticLab(20);
  const source = createSource('image', '固定测试截图');
  source.status = 'partial';
  Object.assign(source.versions[0], {
    assetId: 'fixed-png',
    width: 100,
    height: 80,
    mime: 'image/png',
  });
  p.sources.push(source);
  p = synchronizeLab(p);
  p.lab!.visualResults.push({
    id: 'visual-1',
    sourceId: source.id,
    sourceRevision: 1,
    requestId: 'test-vision',
    promptVersion: 'test@1',
    mode: 'real',
    createdAt: new Date().toISOString(),
    output: { text: '文件导出：导出当前项目。', regions: [], limitations: ['未定位到行坐标'] },
  });
  return { p, source };
}
it('无区域坐标的识别文字经人工核对可形成整图证据，进入跨资料请求且可撤销', () => {
  const { p, source } = imageTranscription();
  const next = acceptImageTranscription(p, 'visual-1', '文件导出：导出当前项目。');
  const e = next.evidence.find((e) => e.sourceId === source.id)!;
  expect(e.location).toMatchObject({ kind: 'image', rect: { x: 0, y: 0, width: 1, height: 1 } });
  expect(evidenceValid(next, e)).toBe(true);
  expect(
    buildLabRequest(next, 'link_evidence').analysis.evidence.some(
      (v) => v.evidenceId === e.evidenceId,
    ),
  ).toBe(true);
  expect(next.findings).toEqual(p.findings);
  expect(acceptImageTranscription(next, 'visual-1', e.excerpt)).toBe(next);
  expect(
    undoResearch(next, next.operations!.at(-1)!.id).evidence.some(
      (v) => v.evidenceId === e.evidenceId,
    ),
  ).toBe(false);
});
it('旧图片版本和空转写拒绝，候选原文和旧证据不改写', () => {
  const { p, source } = imageTranscription();
  expect(() => acceptImageTranscription(p, 'visual-1', '')).toThrow(/1至2000/);
  p.sources.find((s) => s.id === source.id)!.versions[0].revision = 2;
  expect(() => acceptImageTranscription(p, 'visual-1', '人工说明')).toThrow(/版本已变化/);
  expect(p.lab!.visualResults[0].output.text).toBe('文件导出：导出当前项目。');
});
