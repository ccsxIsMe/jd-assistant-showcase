import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
vi.mock('server-only', () => ({}));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { schemaIssues } from '../../src/lib/ai/validation';
import { explorationError } from '../../src/lib/exploration/http';
import { ModelError } from '../../src/lib/ai/errors';
import { readAIResponse } from '../../src/lib/workbench/request-error';
import { decisionFields } from '../../src/lib/decisions/schema';
import { inspectDecision } from '../../src/lib/decisions/quality';
beforeEach(() => {
  vi.stubEnv('AI_MODE', 'real');
  vi.stubEnv('DEEPSEEK_API_KEY', 'unit-test-only-placeholder');
  vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash');
  vi.stubEnv('DEEPSEEK_BASE_URL', 'https://unit.example');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function response(content: string, finish = 'stop') {
  return Response.json({
    id: 'test-completion',
    object: 'chat.completion',
    created: 0,
    model: 'deepseek-flash',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}
const call = (schema: z.ZodType) => ({
  schema,
  system: '只输出JSON。示例：{"ok":true}',
  input: { test: 'fixed-non-sensitive' },
  signal: new AbortController().signal,
});
it('实际SDK JSON经别名兼容、Zod和质量校验，空选项不能伪装成成功选择题', async () => {
  const schema = z
    .object({ questions: z.array(z.object({ ...decisionFields, title: z.string() }).strict()) })
    .strict();
  const fetch = vi.spyOn(globalThis, 'fetch');
  fetch.mockResolvedValueOnce(
    response(
      JSON.stringify({
        questions: [
          {
            title: '如何接收满额后的意向？',
            options: [
              { title: '保留本场候补顺序', effect: '需要候补通知规则' },
              { title: '只登记后续场次意向', effect: '不承诺本场名额' },
            ],
          },
        ],
      }),
    ),
  );
  const output = (await callDeepSeekJSON(call(schema))) as z.infer<typeof schema>;
  expect(inspectDecision(output.questions[0]).generation).toBe('ready');
  expect(output.questions[0].choices).toHaveLength(2);
  for (const choices of [null, [], [{ id: 'other', label: '其他，请填写', impact: '辅助动作' }]]) {
    fetch.mockResolvedValueOnce(
      response(JSON.stringify({ questions: [{ title: '如何接收满额后的意向？', choices }] })),
    );
    const invalid = (await callDeepSeekJSON(call(schema))) as z.infer<typeof schema>;
    expect(inspectDecision(invalid.questions[0]).ready).toBe(false);
  }
});
it('使用真实SDK生成json_object请求并继续执行Zod，兼容警告无需全局关闭', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('{"ok":true}'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await callDeepSeekJSON(call(z.object({ ok: z.literal(true) }).strict()))).toEqual({
    ok: true,
  });
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(
    body.messages.some(
      (m: { role: string; content: string }) =>
        m.role === 'system' && m.content.includes('JSON Schema'),
    ),
  ).toBe(true);
  expect(warn).not.toHaveBeenCalled();
});
it('真实SDK返回合法JSON但字段错误仍拒绝，诊断不包含返回值', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('{"kind":"private-wrong-value"}'));
  const error = await callDeepSeekJSON(
    call(z.object({ kind: z.enum(['feature', 'scenario']) })),
  ).catch((e) => e);
  if (!(error instanceof ModelError)) throw new Error('Expected validated model error');
  expect(error).toMatchObject({
    code: 'INVALID_FORMAT',
    validationIssues: [{ code: 'SCHEMA_INVALID_VALUE', path: 'kind' }],
  });
  expect(JSON.stringify(error.validationIssues)).not.toContain('private-wrong-value');
});
it('图像像素通过实际SDK编码为image_url；普通文字请求不会暗中发送图像', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => response('{"ok":true}'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  await callDeepSeekJSON({
    ...call(z.object({ ok: z.literal(true) })),
    images: [{ data: png, mime: 'image/png' }],
  });
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body.messages.find((m: { role: string }) => m.role === 'user').content).toContainEqual({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
  });
  await callDeepSeekJSON(call(z.object({ ok: z.literal(true) })));
  const textBody = JSON.parse(String(fetch.mock.calls[1][1]?.body));
  expect(JSON.stringify(textBody.messages)).not.toContain('image_url');
  expect(warn).not.toHaveBeenCalled();
});
it('真实SDK对截断、空输出及非法JSON保留独立分类', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  fetch.mockResolvedValueOnce(response('{"ok":', 'length'));
  await expect(callDeepSeekJSON(call(z.object({ ok: z.boolean() })))).rejects.toMatchObject({
    code: 'OUTPUT_TRUNCATED',
  });
  fetch.mockResolvedValueOnce(response(''));
  await expect(callDeepSeekJSON(call(z.object({ ok: z.boolean() })))).rejects.toMatchObject({
    code: 'EMPTY_OUTPUT',
  });
  fetch.mockResolvedValueOnce(response('invalid json'));
  await expect(callDeepSeekJSON(call(z.object({ ok: z.boolean() })))).rejects.toMatchObject({
    code: 'INVALID_FORMAT',
  });
});
it('未知字段路径与非法枚举值不会进入安全诊断', () => {
  const parsed = z
    .record(z.string(), z.number())
    .safeParse({ 'private-record-key': 'private-field-value' });
  if (parsed.success) throw new Error('fixture must fail');
  const safe = schemaIssues(parsed.error);
  expect(safe[0].path).toBe('字段');
  expect(JSON.stringify(safe)).not.toContain('private-record-key');
  expect(JSON.stringify(safe)).not.toContain('private-field-value');
});
it.each([
  ['null', 'EMPTY_OUTPUT'],
  ['false', 'INVALID_FORMAT'],
  ['[]', 'INVALID_FORMAT'],
] as const)('非对象JSON %s必须被拒绝', async (content, code) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(content));
  await expect(callDeepSeekJSON(call(z.object({ ok: z.boolean() })))).rejects.toMatchObject({
    code,
  });
});
it('服务端安全诊断经实际响应解析到前端，不丢失规则和请求编号', async () => {
  const issue = {
    code: 'EXPLICIT_EVIDENCE',
    path: 'findings[0].basis',
    message: '网页观察不能替代用户决定。',
  };
  const result = explorationError(
    new ModelError('INVALID_FORMAT', '校验失败', 422, [issue], 2),
    'fixed-request',
    new AbortController().signal,
    'ai',
  );
  await expect(readAIResponse(result)).rejects.toMatchObject({
    code: 'INVALID_FORMAT',
    requestId: 'fixed-request',
    validationIssues: [issue],
  });
});
