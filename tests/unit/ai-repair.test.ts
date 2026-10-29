import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/ai/adapter', () => ({ callDeepSeekJSON: vi.fn() }));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { runWorkbenchAI } from '../../src/lib/ai/workbench-service';
import { ModelError } from '../../src/lib/ai/errors';
import { extractRequirements } from '../../src/lib/ai/tasks/extract-requirements';
import { sampleMaterial } from '../../src/lib/ai/tasks/common';
import type { AIRequest } from '../../src/lib/workbench/ai-contract';
const input: AIRequest = {
  action: 'extract',
  mode: 'real',
  context: { id: 'repair-workspace', revision: 1, ...sampleMaterial },
  intent: '',
  targetId: null,
};
beforeEach(() => {
  vi.mocked(callDeepSeekJSON).mockReset();
});
it('格式错误最多受控修复一次，不无限调用', async () => {
  vi.mocked(callDeepSeekJSON).mockRejectedValue(new ModelError('INVALID_FORMAT', 'test', 422));
  await expect(runWorkbenchAI(input, new AbortController().signal)).rejects.toThrow();
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
});
it('认证和余额错误不自动重试', async () => {
  vi.mocked(callDeepSeekJSON).mockRejectedValue(new ModelError('AUTHENTICATION', 'test', 401));
  await expect(runWorkbenchAI(input, new AbortController().signal)).rejects.toThrow();
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
it('一次格式失败后合法结果可以返回，业务状态仍未直接写入', async () => {
  vi.mocked(callDeepSeekJSON)
    .mockRejectedValueOnce(new ModelError('EMPTY_OUTPUT', 'test', 422))
    .mockResolvedValueOnce(extractRequirements.exampleOutput);
  const result = await runWorkbenchAI(input, new AbortController().signal);
  expect(result.tasks).toHaveLength(1);
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
  expect(input.context.items).toHaveLength(1);
});
