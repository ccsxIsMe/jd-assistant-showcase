import { z } from 'zod';
export const demoIdentitySchema = z
  .object({
    fixture: z.enum(['paperboat', 'software-engineer']),
    version: z.literal(1),
    instanceId: z.string().min(1),
    kind: z.enum(['demo', 'personal-copy']),
    seed: z.enum(['inputs', 'complete']),
    originInstanceId: z.string().optional(),
    retired: z.boolean().optional(),
  })
  .strict();
export type DemoIdentity = z.infer<typeof demoIdentitySchema>;
export const DEMO_NOTICE = '示例项目｜虚构材料｜预置分析结果';
export function demoFixtureKey(demo?: DemoIdentity) {
  return demo?.fixture === 'software-engineer'
    ? ('software-engineer@1' as const)
    : demo?.fixture === 'paperboat'
      ? ('paperboat@1' as const)
      : undefined;
}
