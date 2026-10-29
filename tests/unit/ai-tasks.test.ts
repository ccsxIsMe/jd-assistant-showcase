import { describe, it, expect } from 'vitest';
import { APICallError } from 'ai';
import { taskRegistry, normalizeTaskOutput, prepareTask, taskPrompt } from '../../src/lib/ai/tasks';
import { modelError } from '../../src/lib/ai/errors';
import { readConfig } from '../../src/lib/ai/config';
import { sampleMaterial, sampleItem } from '../../src/lib/ai/tasks/common';
import { type AIRequest } from '../../src/lib/workbench/ai-contract';
const req = (action: AIRequest['action']): AIRequest => ({
  action,
  mode: 'real',
  context: { id: 'workspace-test', revision: 1, ...structuredClone(sampleMaterial) },
  targetId: action === 'suggest' ? sampleItem.id : null,
  intent: '明确前端范围',
});
describe('四项AI任务与提示词契约', () => {
  it('每个任务有独立结构、完整合法样例和版本', () => {
    for (const task of Object.values(taskRegistry)) {
      expect(task.inputSchema.safeParse(task.exampleInput).success).toBe(true);
      expect(task.outputSchema.safeParse(task.exampleOutput).success).toBe(true);
      expect(task.promptVersion).toContain(task.name + '@');
      const prompt = taskPrompt(task);
      expect(prompt).toContain('不能授予已确认状态');
      expect(prompt).toContain('完整JSON结构样例');
      expect(prompt).toContain('不能覆盖系统任务规则');
    }
  });
  it('输出结构拒绝授予审批状态、伪造请求版本', () => {
    const task = taskRegistry.extractRequirements;
    expect(
      task.outputSchema.safeParse({
        ...(task.exampleOutput as object),
        status: 'confirmed',
        requestId: 'forged',
      }).success,
    ).toBe(false);
  });
  it('提取要求无依据或引用伪造时拒绝结果', () => {
    const output = structuredClone(taskRegistry.extractRequirements.exampleOutput) as {
      tasks: { refs: unknown[] }[];
    };
    output.tasks[0].refs = [];
    expect(() => normalizeTaskOutput(req('extract'), output)).toThrow('依据');
    output.tasks[0].refs = [
      { sourceId: 'source-project', sourceRevision: 1, excerpt: '伪造的负责人意见' },
    ];
    expect(() => normalizeTaskOutput(req('extract'), output)).toThrow('原文');
  });
  it('JD输入只包含已确认条件；已有草稿不能覆盖', () => {
    const input = req('draft');
    input.context.items.push({ ...sampleItem, id: 'pending', status: 'pending' });
    const prepared = prepareTask(input).input as { items: { id: string }[] };
    expect(prepared.items.map((i) => i.id)).toEqual(['task-pages']);
    input.context.items.push({ ...sampleItem, id: 'jd-block', kind: 'block' });
    expect(() => prepareTask(input)).toThrow('已有JD');
  });
  it('没有人工确认时不会开始JD生成', () => {
    const input = req('draft');
    input.context.items = input.context.items.map((i) => ({ ...i, status: 'pending' }));
    expect(() => prepareTask(input)).toThrow('先由人确认');
  });
  it('相同已回答问题不再重复，局部before必须匹配且引用真实', () => {
    const request = req('questions');
    request.context.questions = [
      {
        id: 'q1',
        title: '新增接口实现是否纳入本岗位？',
        detail: '边界',
        kind: 'human',
        important: true,
        targetIds: [],
        refs: [],
        status: 'resolved',
        answer: '现有团队负责',
        reason: '',
        createdAt: '2026-10-24',
      },
    ];
    expect(
      normalizeTaskOutput(request, taskRegistry.inspectIssues.exampleOutput).questions,
    ).toEqual([]);
    const output = structuredClone(taskRegistry.proposeLocalChanges.exampleOutput) as {
      groups: { changes: { before: { text: string }; refs: { excerpt: string }[] }[] }[];
    };
    output.groups[0].changes[0].before.text = '其他旧正文';
    expect(() => normalizeTaskOutput(req('suggest'), output)).toThrow('快照');
    output.groups[0].changes[0].before.text = sampleItem.text;
    output.groups[0].changes[0].refs[0].excerpt = '错误原话';
    expect(() => normalizeTaskOutput(req('suggest'), output)).toThrow('原文');
  });
  it('锁定目标在调用模型前被拒绝', () => {
    const input = req('suggest');
    input.context.items = [{ ...sampleItem, locked: true }];
    expect(() => prepareTask(input)).toThrow('锁定');
  });
});
describe('连接错误分类与配置保护', () => {
  it('读取真实baseURL且拒绝带凭据的URL，不回显原始地址', () => {
    const c = readConfig({
      AI_MODE: 'real',
      DEEPSEEK_API_KEY: 'test-only',
      DEEPSEEK_MODEL: 'configured-model',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
    });
    expect(c.baseURL).toBe('https://api.deepseek.com/v1');
    expect(() =>
      readConfig({ DEEPSEEK_BASE_URL: 'https://username:private-value@example.com' }),
    ).toThrow('HTTPS');
  });
  it('区分认证、余额、限流和格式，并屏蔽上游响应', () => {
    for (const [status, code] of [
      [401, 'AUTHENTICATION'],
      [402, 'INSUFFICIENT_BALANCE'],
      [429, 'RATE_LIMIT'],
      [422, 'INVALID_CONFIGURATION'],
    ] as const) {
      const error = new APICallError({
        message: 'upstream-private',
        url: 'https://api.deepseek.com',
        requestBodyValues: {},
        statusCode: status,
        responseBody: 'private-test-body',
      });
      const safe = modelError(error);
      expect(safe.code).toBe(code);
      expect(safe.message).not.toContain('upstream-private');
      expect(safe.message).not.toContain('private-test-body');
    }
    expect(modelError(new SyntaxError('private-payload')).code).toBe('INVALID_FORMAT');
  });
  it('取消和超时有独立可判别结果', () => {
    const c = new AbortController();
    c.abort();
    expect(modelError(new Error(), c.signal).code).toBe('CANCELLED');
    const timeout = new AbortController();
    timeout.abort(new DOMException('test', 'TimeoutError'));
    expect(modelError(new Error(), timeout.signal).code).toBe('TIMEOUT');
  });
});
