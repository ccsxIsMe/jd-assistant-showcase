import { z } from 'zod';
import { itemSchema } from '@/lib/workbench/model';
import {
  materialInput,
  localOutput,
  sampleMaterial,
  sampleFields,
  sampleRef,
  sampleItem,
  type TaskDefinition,
} from './common';
export const proposeLocalChanges: TaskDefinition = {
  name: 'proposeLocalChanges',
  promptVersion: 'proposeLocalChanges@1.3.0',
  inputSchema: materialInput
    .extend({
      target: itemSchema,
      intent: z.string().min(1).max(4000),
      allowedItems: z.array(itemSchema).max(100),
      lockedIds: z.array(z.string()),
    })
    .strict(),
  outputSchema: localOutput,
  instruction:
    '根据target和用户intent仅为allowedItems中未锁定对象提出修改。items是上下文，不代表修改授权，allowedItems才是允许的目标清单。lockedIds中的对象禁止修改。每条返回targetId、完整before与after白名单字段、update/exclude操作、reason、refs及impactIds。before必须逐字等于本次对象字段，不让模型决定版本号。独立建议分成独立组；必须一起生效的关联修改放同一组并说明原因。未选择或非直接关联内容不得修改。不要静默删除要求：可以建议exclude，由人决定。更新已有JD时只改允许的段落，只使用status=confirmed的任务和要求以及已明确记录的人工决定，保留人工表述与必须、加分、可培养的区别；未确认薪资、福利、地点不得写成事实。不借机修改任务与要求。无可改内容时groups为空并说明。',
  exampleInput: {
    ...sampleMaterial,
    target: sampleItem,
    intent: '明确只负责前端页面，与现有后端团队联调。',
    allowedItems: [sampleItem],
    lockedIds: [],
  },
  exampleOutput: {
    groups: [
      {
        reason: '独立修改建议，可单独采纳',
        changes: [
          {
            targetId: 'task-pages',
            before: sampleFields,
            operation: 'update',
            after: { ...sampleFields, scope: '仅前端页面；后端接口与数据库边界待负责人确认' },
            reason: '已有资料支持页面交付，但没有支持独立后端职责，建议明确边界并保留待确认事项。',
            refs: [sampleRef],
            impactIds: [],
          },
        ],
      },
    ],
    notice: '预览不会修改任何数据。',
  },
};
