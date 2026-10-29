import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DecisionInput } from '../../src/components/decisions/decision-input';
import { aiOutputSchema, emptyAI } from '../../src/lib/workbench/ai-contract';
it('缺失业务选项不能只显示辅助按钮，应明确提示尚未生成完成', () => {
  const html = renderToStaticMarkup(
    createElement(DecisionInput, {
      label: '角色在游戏中的定位和美术风格是什么？',
      onSave: () => {},
    }),
  );
  expect(html).toContain('可选方案尚未生成完成');
  expect(html).not.toContain('以上都不适用');
});
it('工作台模型输出必须可以完整保存真实业务选项', () => {
  expect(
    aiOutputSchema.safeParse({
      ...emptyAI(),
      questions: [
        {
          title: '主要工作范围是什么？',
          detail: '用于比较职责边界',
          important: true,
          targetIds: [],
          refs: [],
          choices: [
            { id: 'ui', label: '界面与交互实现', impact: '侧重页面交付' },
            { id: 'api', label: '服务与数据处理', impact: '侧重接口交付' },
          ],
        },
      ],
    }).success,
  ).toBe(true);
});
