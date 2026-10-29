import { it, expect, vi, afterEach } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/ai/adapter', () => ({ callDeepSeekJSON: vi.fn() }));
import { POST } from '../../src/app/api/resume/review/route';
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { ModelError } from '../../src/lib/ai/errors';
import {
  newReviewSession,
  prepareResumeRequest,
  standardFromJd,
} from '../../src/lib/resume/domain';
import { mockResumeReview } from '../../src/lib/resume/mock';
afterEach(() => vi.mocked(callDeepSeekJSON).mockReset());
function input() {
  const s = newReviewSession(standardFromJd('负责活动报名表单与名单导出的页面交付。'));
  s.material.text = '在活动项目中负责活动报名表单与名单导出的页面交付。';
  return prepareResumeRequest(s, true);
}
const request = (data: unknown) =>
  new Request('http://127.0.0.1:3002/api/resume/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3002' },
    body: JSON.stringify(data),
  });
it('示例接口主动确认、结构校验和上下文绑定，不调用真实模型', async () => {
  const i = input(),
    res = await POST(request(i)),
    body = await res.json();
  expect(res.status).toBe(200);
  expect(body.sessionId).toBe(i.sessionId);
  expect(body.standardSignature).toBe(i.standard.signature);
  expect(body.requestId).toBeTruthy();
  expect(body.data.assessments[0].state).toBe('explicit');
  expect(callDeepSeekJSON).not.toHaveBeenCalled();
  expect((await POST(request({ ...i, consent: false }))).status).toBe(422);
});
it('无效引用只有限修复一次，失败不回退预置', async () => {
  const i = { ...input(), mode: 'real' },
    bad = mockResumeReview(input());
  bad.assessments[0].requirementId = 'missing';
  vi.mocked(callDeepSeekJSON).mockResolvedValue(bad);
  const r = await POST(request(i));
  expect(r.status).toBe(422);
  expect((await r.json()).code).toBe('INVALID_REFERENCE');
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
});
it.each([
  ['AUTHENTICATION', 401],
  ['BALANCE', 402],
  ['RATE_LIMIT', 429],
  ['TIMEOUT', 504],
  ['CONFIGURATION', 503],
] as const)('真实模式%s明确失败且不返回成功报告', async (code, status) => {
  vi.mocked(callDeepSeekJSON).mockRejectedValue(new ModelError(code, '固定非敏感测试错误', status));
  const res = await POST(request({ ...input(), mode: 'real' }));
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.code).toBe(code);
  expect(body).not.toHaveProperty('data');
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
