import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/ai/exploration-service', () => ({ runExplorationAnalysis: vi.fn() }));
import { runExplorationAnalysis } from '../../src/lib/ai/exploration-service';
import { POST } from '../../src/app/api/exploration/analyze/route';
import { ModelError } from '../../src/lib/ai/errors';
afterEach(() => vi.restoreAllMocks());
it('实际Route记录请求编号和安全规则，日志与响应不包含原始研究或模型请求', async () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../docs/ai-tasks/exploreRequirements.json', import.meta.url), 'utf8'),
  );
  const input = fixture.input;
  input.sources[0].versions[0].text = 'private-canary-research-body';
  const issue = {
    code: 'EXPLICIT_EVIDENCE',
    path: 'findings[0].basis',
    message: '网页观察不能替代用户决定。',
  };
  vi.mocked(runExplorationAnalysis).mockRejectedValue(
    new ModelError('INVALID_FORMAT', '校验失败，原数据保留', 422, [issue], 2),
  );
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const response = await POST(
    new Request('http://127.0.0.1:3002/api/exploration/analyze', {
      method: 'POST',
      headers: { host: '127.0.0.1:3002', 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
  const body = await response.json();
  expect(response.status).toBe(422);
  expect(body.validationIssues).toEqual([issue]);
  expect(body.attempts).toBe(2);
  expect(body.requestId).toBeTruthy();
  expect(log).toHaveBeenCalledTimes(1);
  const diagnostic = JSON.parse(String(log.mock.calls[0][0]));
  expect(diagnostic).toMatchObject({
    event: 'exploration_request_failed',
    requestId: body.requestId,
    code: 'INVALID_FORMAT',
    validationIssues: [issue],
  });
  expect(JSON.stringify(diagnostic)).not.toContain('private-canary-research-body');
  expect(JSON.stringify(body)).not.toContain('private-canary-research-body');
});
