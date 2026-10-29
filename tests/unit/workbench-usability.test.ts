import { expect, it } from 'vitest';
import { APICallError } from 'ai';
import { modelError } from '../../src/lib/ai/errors';
import { newItem, newWorkspace, workspaceSchema, fields } from '../../src/lib/workbench/model';
import { fitColumns } from '../../src/lib/workbench/layout';
import { AIRequestError, readAIResponse } from '../../src/lib/workbench/request-error';
import { prepareTask, normalizeTaskOutput, taskRegistry } from '../../src/lib/ai/tasks';
import { emptyAI, type AIRequest } from '../../src/lib/workbench/ai-contract';
import { applySuggestion, setItemState } from '../../src/lib/workbench/domain';
import { ingestAI, validateAIResult } from '../../src/lib/workbench/ai-apply';
import { sampleMaterial } from '../../src/lib/ai/tasks/common';

it('旧岗位宽度默认值兼容；窄桌面与折叠状态保留编辑区', () => {
  const raw = newWorkspace('旧数据兼容');
  const old = { ...raw, ui: { ...raw.ui, leftWidth: undefined, rightWidth: undefined } };
  expect(workspaceSchema.parse(old).ui.leftWidth).toBe(240);
  expect(workspaceSchema.parse(old).ui.rightWidth).toBe(340);
  const full = fitColumns(1000, { ...raw.ui, leftWidth: 440, rightWidth: 520 });
  expect(full.leftWidth + full.rightWidth + 20).toBeLessThanOrEqual(660);
  const collapsed = fitColumns(1000, { ...raw.ui, leftOpen: false, rightWidth: 520 });
  expect(collapsed.rightWidth).toBe(520);
});

it('上游502、网络断开与内部异常区分，错误不泄漏原始请求', () => {
  const upstream = new APICallError({
    message: 'private request',
    url: 'https://api.deepseek.com',
    requestBodyValues: {},
    statusCode: 503,
    responseBody: 'private output',
  });
  expect(modelError(upstream).code).toBe('UPSTREAM');
  expect(modelError(upstream).message).toContain('503');
  expect(modelError(upstream).message).not.toContain('private');
  const network = new Error('private error', {
    cause: Object.assign(new Error('private'), { code: 'ECONNRESET' }),
  });
  expect(modelError(network).code).toBe('NETWORK');
  expect(modelError(network).message).toContain('ECONNRESET');
  expect(modelError(new Error('internal-private')).code).toBe('INTERNAL');
});

it('客户端保留错误编号，非JSON网关502也能明确显示和重试', async () => {
  await expect(
    readAIResponse(
      Response.json(
        { error: 'network error', code: 'NETWORK', requestId: 'request-test' },
        { status: 502 },
      ),
    ),
  ).rejects.toMatchObject({ code: 'NETWORK', requestId: 'request-test', status: 502 });
  await expect(
    readAIResponse(new Response('<html>gateway error</html>', { status: 502 })),
  ).rejects.toBeInstanceOf(AIRequestError);
});

it('只更新所选JD段落时，关联任务是上下文而非修改授权', () => {
  const request: AIRequest = {
    action: 'suggest',
    mode: 'real',
    context: { id: 'test-workspace', revision: 1, ...structuredClone(sampleMaterial) },
    targetId: 'jd-block',
    scope: 'selected',
    intent: '更新JD',
  };
  const block = newItem('block', '主要职责', '旧正文');
  block.id = 'jd-block';
  block.taskIds = ['task-pages'];
  request.context.items.push(block);
  const input = prepareTask(request).input as {
    allowedItems: { id: string }[];
    items: { id: string }[];
  };
  expect(input.allowedItems.map((i) => i.id)).toEqual(['jd-block']);
  expect(input.items.some((i) => i.id === 'task-pages')).toBe(true);
  const output = taskRegistry.proposeLocalChanges.exampleOutput;
  expect(() => validateAIResult(request, normalizeTaskOutput(request, output))).toThrow('未选中');
});

it('更新草稿先审阅；确认上下文变更或新条目让旧建议失效', () => {
  let w = newWorkspace('测试');
  const task = newItem('task', '页面交付', '确认的页面交付');
  task.status = 'confirmed';
  const block = newItem('block', '主要职责', '保留的人工正文');
  block.taskIds = [task.id];
  w.items.push(task, block);
  const request: AIRequest = {
    action: 'suggest',
    mode: 'example',
    context: w,
    targetId: block.id,
    scope: 'selected',
    intent: '更新 JD',
  };
  const data = emptyAI();
  data.groups = [
    {
      reason: '测试',
      changes: [
        {
          targetId: block.id,
          after: { ...fields(block), text: '新建议' },
          operation: 'update',
          reason: '已确认任务',
          refs: [],
        },
      ],
    },
  ];
  const proposed = ingestAI(w, w, request, data);
  expect(proposed.items.find((i) => i.id === block.id)!.text).toBe('保留的人工正文');
  const id = proposed.suggestions[0].suggestionId;
  expect(applySuggestion(proposed, id).items.find((i) => i.id === block.id)!.text).toBe('新建议');
  w = setItemState(proposed, task.id, 'review');
  expect(() => applySuggestion(w, id)).toThrow();
  const added = structuredClone(proposed);
  added.items.push(newItem('task', '新增任务'));
  expect(() => applySuggestion(added, id)).toThrow();
});
