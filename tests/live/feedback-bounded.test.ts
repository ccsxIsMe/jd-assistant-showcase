import { test, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
vi.mock('server-only', () => ({}));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { readConfig } from '../../src/lib/ai/config';
import { ModelError } from '../../src/lib/ai/errors';
import { prepareTask, taskPrompt, normalizeTaskOutput } from '../../src/lib/ai/tasks';
import { sampleMaterial } from '../../src/lib/ai/tasks/common';
import { validateAIResult } from '../../src/lib/workbench/ai-apply';
import type { AIRequest } from '../../src/lib/workbench/ai-contract';
import {
  visionOutputSchema,
  visionPrompt,
  visionPromptVersion,
} from '../../src/lib/lab/vision-contract';

// Explicit, single-run authorization flag. Excluded from normal unit/browser tests.
test.skipIf(process.env.ALLOW_THREE_LIVE_CALLS !== '1')(
  '授权的固定无敏感反馈联调：最多三个真实网络请求，关闭自动修复',
  async () => {
    process.loadEnvFile('.env.local');
    const config = readConfig();
    if (config.mode !== 'real' || !config.apiKey)
      throw new Error('本地真实模式配置缺失，未调用模型');
    const nativeFetch = globalThis.fetch.bind(globalThis);
    let networkCalls = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (networkCalls >= 3) throw new Error('本轮授权最多3次网络请求，已阻止额外调用');
      networkCalls++;
      return nativeFetch(input, init);
    });
    const records: Record<string, unknown>[] = [];
    const context = {
      id: 'synthetic-feedback-live',
      revision: 1,
      ...structuredClone(sampleMaterial),
    };
    for (const item of context.items) item.status = 'confirmed';
    try {
      for (const action of ['draft', 'suggest', 'image'] as const) {
        try {
          const signal = AbortSignal.timeout(50000);
          if (action === 'image') {
            const bytes = await readFile('public/demo/software-engineer/interface.png');
            const raw = await callDeepSeekJSON({
              schema: visionOutputSchema,
              system: visionPrompt,
              input: {
                task: 'extract_image_evidence',
                notice: '固定演示界面，非用户资料',
                width: 1000,
                height: 720,
              },
              images: [{ data: bytes, mime: 'image/png' }],
              signal,
              maxTokens: 4000,
            });
            const output = visionOutputSchema.parse(raw);
            const usable =
              output.text.trim().length > 0 || output.regions.some((r) => r.excerpt.trim());
            if (!usable) throw new ModelError('EMPTY_OUTPUT', '未识别到可用图像内容', 422);
            records.push({
              task: 'extract_image_evidence',
              status: 'passed',
              promptVersion: visionPromptVersion,
              textLength: output.text.length,
              regions: output.regions.length,
              mentionsExport: /导出|export/i.test(
                output.text + output.regions.map((r) => r.label + r.excerpt).join(' '),
              ),
            });
          } else {
            const req: AIRequest = {
              action,
              mode: 'real',
              context,
              targetId: action === 'suggest' ? context.items[0].id : null,
              intent: '精简选中任务的表述，保留页面交付范围，不增加职责或承诺。',
            };
            const { task, input } = prepareTask(req);
            const raw = await callDeepSeekJSON({
              schema: task.outputSchema,
              system: taskPrompt(task),
              input,
              signal,
              maxTokens: 5000,
            });
            const output = validateAIResult(req, normalizeTaskOutput(req, raw));
            if (action === 'suggest' && !output.groups.length)
              throw new ModelError('EMPTY_OUTPUT', '本次未提出建议，无法验证修改范围', 422);
            records.push({
              task: task.name,
              status: 'passed',
              promptVersion: task.promptVersion,
              blocks: output.blocks.length,
              changes: output.groups.reduce((sum, g) => sum + g.changes.length, 0),
              validatedScope: true,
              validatedCitations: true,
            });
          }
        } catch (error) {
          const code = error instanceof ModelError ? error.code : 'TEST_VALIDATION';
          records.push({
            task: action,
            status: 'failed',
            code,
            ...(error instanceof ModelError && error.validationIssues
              ? { issues: error.validationIssues }
              : {}),
          });
          if (
            ['AUTHENTICATION', 'INSUFFICIENT_BALANCE', 'NETWORK_DENIED', 'CONFIGURATION'].includes(
              code,
            )
          )
            break;
        }
      }
    } finally {
      spy.mockRestore();
      const report = {
        measuredAt: new Date().toISOString(),
        notice:
          '真实API响应校验，输入仅为固定虚构岗位和演示PNG；未读用户研究，未保存原始请求、密钥或模型全文。无自动修复；预算最多3次。',
        model: config.model,
        networkCalls,
        records,
      };
      await writeFile('docs/live-ai-feedback-result.json', JSON.stringify(report, null, 2));
      console.info(JSON.stringify(report));
    }
    if (records.some((r) => r.status !== 'passed') || records.length !== 3)
      throw new Error(
        '真实联调存在未通过项，安全结果见 docs/live-ai-feedback-result.json；不会自动追加调用。',
      );
  },
  165000,
);
