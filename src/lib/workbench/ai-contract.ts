import { z } from 'zod';
import { demoIdentitySchema } from '../demo/identity';
import { decisionFields } from '../decisions/schema';
import { changeFields, itemSchema, refSchema, sourceSchema, questionSchema } from './model';
export const aiContextSchema = z
  .object({
    demo: demoIdentitySchema.optional(),
    id: z.string(),
    revision: z.number().int().positive(),
    title: z.string().max(200),
    sources: z.array(sourceSchema).max(100),
    items: z.array(itemSchema).max(500),
    questions: z.array(questionSchema).max(300).optional(),
    decisions: z
      .array(z.object({ text: z.string().max(5000), at: z.string() }))
      .max(100)
      .optional(),
  })
  .strict();
export const workbenchRequest = z
  .object({
    action: z.enum(['extract', 'draft', 'suggest', 'questions']),
    mode: z.enum(['example', 'real']),
    context: aiContextSchema,
    targetId: z.string().nullable(),
    scope: z.enum(['selected', 'related']).optional(),
    intent: z.string().max(4000),
  })
  .strict();
const citation = z
  .object({
    sourceId: z.string(),
    sourceRevision: z.number().int().positive(),
    excerpt: z.string().min(1).max(3000),
  })
  .strict();
const candidate = z
  .object({
    key: z.string().max(100),
    title: z.string().min(1).max(300),
    text: z.string().max(10000),
    scope: z.string().max(2000),
    category: z.enum(['must', 'bonus', 'train', 'omit']),
    refs: z.array(citation).max(20),
    taskKeys: z.array(z.string()).max(30),
  })
  .strict();
const question = z
  .object({
    ...decisionFields,
    title: z.string().min(1).max(300),
    detail: z.string().max(3000),
    important: z.boolean(),
    targetIds: z.array(z.string()).max(30),
    refs: z.array(citation).max(20),
  })
  .strict();
const modification = z
  .object({
    targetId: z.string(),
    operation: z.enum(['update', 'exclude']),
    after: changeFields,
    reason: z.string().min(1).max(3000),
    refs: z.array(citation).max(20),
  })
  .strict();
export const aiOutputSchema = z
  .object({
    tasks: z.array(candidate).max(30),
    requirements: z.array(candidate).max(30),
    questions: z.array(question).max(30),
    blocks: z
      .array(
        z
          .object({
            title: z.string().min(1).max(300),
            text: z.string().max(10000),
            taskIds: z.array(z.string()),
            requirementIds: z.array(z.string()),
            refs: z.array(citation),
          })
          .strict(),
      )
      .max(30),
    groups: z
      .array(
        z
          .object({ reason: z.string().max(3000), changes: z.array(modification).min(1).max(20) })
          .strict(),
      )
      .max(30),
    notice: z.string().max(2000),
  })
  .strict();
export type AIRequest = z.infer<typeof workbenchRequest>;
export type AIResult = z.infer<typeof aiOutputSchema>;
export const emptyAI = (): AIResult => ({
  tasks: [],
  requirements: [],
  questions: [],
  blocks: [],
  groups: [],
  notice: '',
});
export const localRef = (sourceId: string, sourceRevision: number, excerpt: string) =>
  refSchema.parse({ sourceId, sourceRevision, excerpt, start: null, verified: false });
