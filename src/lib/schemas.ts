import { z } from 'zod';
export const MAX_TEXT = 30000;
export const MAX_FILE = 10 * 1024 * 1024;
export const modeSchema = z.enum(['mock', 'real']);
export type Mode = z.infer<typeof modeSchema>;
const item = z.string().trim().min(1).max(1000);
const items = z.array(item).min(1).max(20);
const note = z.string().trim().max(4000).default('');
export const titleSchema = z.string().trim().min(1, '请填写职位名称').max(100);
export const textSchema = z.string().trim().min(10, '请至少输入10个字符').max(MAX_TEXT);
export const recommendInput = z.object({ title: titleSchema }).strict();
export const generateInput = z
  .object({
    title: titleSchema,
    duties: items,
    skills: items,
    experience: note,
    education: note,
    company: note,
    requirements: note,
  })
  .strict();
export const optimizeInput = z.object({ jd: textSchema, requirements: note }).strict();
export const matchInput = z
  .object({
    jd: textSchema,
    resume: textSchema,
    consent: z.literal(true, { error: '请确认已审阅文本并同意分析' }),
  })
  .strict();
export const recommendOutput = z.object({ duties: items, skills: items }).strict();
export const jdOutput = z.string().trim().min(20).max(50000);
export const optimizeOutput = z
  .object({ strengths: items, weaknesses: items, suggestions: items, optimized: jdOutput })
  .strict();
const score = z.number().int().min(0).max(100);
export const matchOutput = z
  .object({
    overview: z.object({ summary: item, relevantExperience: item, evidence: item }).strict(),
    total: score,
    scores: z
      .array(
        z
          .object({
            dimension: z.enum(['技能证据', '相关经验', '项目成果', '职责关联']),
            score,
            comment: item,
          })
          .strict(),
      )
      .length(4)
      .refine((v) => new Set(v.map((s) => s.dimension)).size === 4, '评分维度不能重复'),
    matches: items,
    gaps: items,
    verification: items,
    suggestions: items,
  })
  .strict()
  .refine(
    (v) => v.total === Math.round(v.scores.reduce((n, s) => n + s.score, 0) / 4),
    '综合评分必须为四项等权平均值',
  );
export const tasks = ['recommend', 'generate', 'optimize', 'match'] as const;
export const taskSchema = z.enum(tasks);
export type Task = z.infer<typeof taskSchema>;
export const inputs = {
  recommend: recommendInput,
  generate: generateInput,
  optimize: optimizeInput,
  match: matchInput,
};
export const outputs = {
  recommend: recommendOutput,
  generate: jdOutput,
  optimize: optimizeOutput,
  match: matchOutput,
};
export type Recommendation = z.infer<typeof recommendOutput>;
export type Optimization = z.infer<typeof optimizeOutput>;
export type MatchReport = z.infer<typeof matchOutput>;
