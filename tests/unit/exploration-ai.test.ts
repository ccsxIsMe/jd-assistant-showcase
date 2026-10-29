import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/ai/adapter', () => ({ callDeepSeekJSON: vi.fn() }));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { runExplorationAnalysis } from '../../src/lib/ai/exploration-service';
import { analysisRequestSchema } from '../../src/lib/exploration/analysis';
import { validateAnalysis } from '../../src/lib/exploration/domain';
import { ModelError } from '../../src/lib/ai/errors';
const fixture = JSON.parse(
  readFileSync(new URL('../../docs/ai-tasks/exploreRequirements.json', import.meta.url), 'utf8'),
);
const input = () =>
  analysisRequestSchema.parse({ ...structuredClone(fixture.input), mode: 'real' });
beforeEach(() => {
  vi.mocked(callDeepSeekJSON).mockReset();
});
it('完整产品分析JSON样例符合输入、输出与引用契约', () => {
  const req = analysisRequestSchema.parse(fixture.input);
  expect(validateAnalysis(req, fixture.output).findings).toHaveLength(1);
});
it('产品分析引用或格式错误最多修复一次，不写入原编辑', async () => {
  const req = input();
  const output = structuredClone(fixture.output);
  output.findings[0].evidenceIds = ['forged'];
  vi.mocked(callDeepSeekJSON).mockResolvedValue(output);
  await expect(runExplorationAnalysis(req, new AbortController().signal)).rejects.toMatchObject({
    code: 'INVALID_FORMAT',
  });
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
  expect(req.confirmedFindings).toEqual([]);
});
it('产品分析认证失败不重试、不回退演示', async () => {
  vi.mocked(callDeepSeekJSON).mockRejectedValue(
    new ModelError('AUTHENTICATION', '测试认证错误', 401),
  );
  await expect(runExplorationAnalysis(input(), new AbortController().signal)).rejects.toMatchObject(
    { code: 'AUTHENTICATION' },
  );
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
it('网页误标explicit时将精确失败原因及原草稿用于一次修复', async () => {
  const req = input();
  req.evidence[0].evidenceType = 'web-text';
  const wrong = structuredClone(fixture.output);
  wrong.findings[0].basis = 'explicit';
  const corrected = structuredClone(wrong);
  corrected.findings[0].basis = 'observed';
  const before = structuredClone(req);
  vi.mocked(callDeepSeekJSON).mockResolvedValueOnce(wrong).mockResolvedValueOnce(corrected);
  const result = await runExplorationAnalysis(req, new AbortController().signal);
  expect(result.findings[0].basis).toBe('observed');
  const second = vi.mocked(callDeepSeekJSON).mock.calls[1][0].input as {
    repair: { issues: { code: string; path: string }[]; previousOutput: unknown };
    evidenceCatalog: { canSupportExplicit: boolean }[];
  };
  expect(second.repair.issues[0]).toMatchObject({
    code: 'EXPLICIT_EVIDENCE',
    path: 'findings[0].basis',
  });
  expect(second.repair.previousOutput).toEqual(wrong);
  expect(second.evidenceCatalog[0].canSupportExplicit).toBe(false);
  expect(req).toEqual(before);
});
it('两次不合法结果仍拒绝，返回安全规则与路径而非笼统422', async () => {
  const req = input();
  req.evidence[0].evidenceType = 'web-text';
  const wrong = structuredClone(fixture.output);
  wrong.findings[0].basis = 'explicit';
  vi.mocked(callDeepSeekJSON).mockResolvedValue(wrong);
  await expect(runExplorationAnalysis(req, new AbortController().signal)).rejects.toMatchObject({
    code: 'INVALID_FORMAT',
    attempts: 2,
    validationIssues: [{ code: 'EXPLICIT_EVIDENCE', path: 'findings[0].basis' }],
  });
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
});
it('sourceId冒充evidenceId不能通过，修复反馈准确定位引用规则', async () => {
  const req = input();
  const wrong = structuredClone(fixture.output);
  wrong.findings[0].evidenceIds = [req.sources[0].id];
  vi.mocked(callDeepSeekJSON).mockResolvedValue(wrong);
  await expect(runExplorationAnalysis(req, new AbortController().signal)).rejects.toMatchObject({
    validationIssues: expect.arrayContaining([
      expect.objectContaining({ code: 'EVIDENCE_REFERENCE' }),
    ]),
  });
});
it('结构问题与程序异常分开：枚举可修复，未知内部错误不自动重发', async () => {
  const wrong = structuredClone(fixture.output);
  wrong.findings[0].phase = 'private-invalid-value';
  vi.mocked(callDeepSeekJSON).mockResolvedValue(wrong);
  const error = await runExplorationAnalysis(input(), new AbortController().signal).catch((e) => e);
  expect(error.validationIssues[0]).toMatchObject({
    code: 'SCHEMA_INVALID_VALUE',
    path: 'findings[0].phase',
  });
  expect(JSON.stringify(error.validationIssues)).not.toContain('private-invalid-value');
  vi.mocked(callDeepSeekJSON).mockReset().mockRejectedValue(new Error('internal fault'));
  await expect(runExplorationAnalysis(input(), new AbortController().signal)).rejects.toThrow(
    'internal fault',
  );
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
it('一次修复同时提供多个语义问题，不必逐个规则反复计费重试', async () => {
  const req = input();
  req.evidence[0].evidenceType = 'web-text';
  const wrong = structuredClone(fixture.output);
  wrong.findings[0].basis = 'explicit';
  wrong.questions[0].findingKeys = ['missing-finding'];
  const corrected = structuredClone(fixture.output);
  corrected.findings[0].basis = 'observed';
  vi.mocked(callDeepSeekJSON).mockResolvedValueOnce(wrong).mockResolvedValueOnce(corrected);
  await runExplorationAnalysis(req, new AbortController().signal);
  const second = vi.mocked(callDeepSeekJSON).mock.calls[1][0].input as {
    repair: { issues: { code: string }[] };
  };
  expect(second.repair.issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(['EXPLICIT_EVIDENCE', 'QUESTION_REFERENCE']),
  );
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
});
it('连续空输出最多修复一次，保留空输出分类', async () => {
  vi.mocked(callDeepSeekJSON).mockRejectedValue(new ModelError('EMPTY_OUTPUT', '模型为空', 422));
  await expect(runExplorationAnalysis(input(), new AbortController().signal)).rejects.toMatchObject(
    { code: 'EMPTY_OUTPUT', attempts: 2 },
  );
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
});
it.each(['OUTPUT_TRUNCATED', 'TIMEOUT', 'INSUFFICIENT_BALANCE', 'RATE_LIMIT'])(
  '%s不触发格式修复重试',
  async (code) => {
    vi.mocked(callDeepSeekJSON).mockRejectedValue(new ModelError(code, 'fixed failure', 422));
    await expect(
      runExplorationAnalysis(input(), new AbortController().signal),
    ).rejects.toMatchObject({ code });
    expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
  },
);
