import { z } from 'zod';
import { demoIdentitySchema } from '../demo/identity';
import { decisionFields, decisionResponseSchema } from '../decisions/schema';
import { researchImportSchema } from '../exploration/material-model';
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const statusSchema = z.enum(['pending', 'confirmed', 'excluded', 'review']);
export const kindSchema = z.enum(['task', 'requirement', 'block']);
export const refSchema = z
  .object({
    sourceId: z.string(),
    sourceRevision: z.number().int().positive(),
    excerpt: z.string().min(1).max(3000),
    start: z.number().int().nonnegative().nullable(),
    verified: z.boolean(),
  })
  .strict();
export const sourceSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  type: z.enum(['person', 'project', 'old-jd', 'supplement', 'file']),
  person: z.string().max(200),
  createdAt: z.string(),
  removed: z.boolean(),
  snapshotOrigin: z
    .object({
      snapshotId: z.string(),
      explorationId: z.string(),
      version: z.number().int().positive(),
      mode: z.enum(['example', 'real']),
      title: z.string().max(200),
      createdAt: z.string(),
      evidenceIds: z.array(z.string()),
      sources: z.array(
        z.object({
          id: z.string(),
          title: z.string().max(200),
          revision: z.number().int().positive(),
          url: z.string().max(2000),
        }),
      ),
    })
    .optional(),
  versions: z
    .array(
      z.object({
        revision: z.number().int().positive(),
        text: z.string().max(30000),
        createdAt: z.string(),
        image: z
          .object({
            assetId: z.string().min(1),
            filename: z.string().max(300),
            mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
            size: z
              .number()
              .int()
              .positive()
              .max(8 * 1024 * 1024),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .refine((v) => v.width * v.height <= 24000000, '图片超过2400万像素')
          .optional(),
      }),
    )
    .min(1),
});
export const itemSchema = z
  .object({
    id: z.string(),
    kind: kindSchema,
    revision: z.number().int().positive(),
    title: z.string().min(1).max(300),
    text: z.string().max(10000),
    scope: z.string().max(2000),
    priority: z.enum(['high', 'medium', 'low']),
    category: z.enum(['must', 'bonus', 'train', 'omit', 'unknown']),
    status: statusSchema,
    locked: z.boolean(),
    refs: z.array(refSchema).max(30),
    taskIds: z.array(z.string()).max(100),
    requirementIds: z.array(z.string()).max(100),
    origin: z.enum(['user', 'ai']),
    lastChange: z.string(),
    researchLink: z
      .object({
        importId: z.string(),
        snapshotId: z.string(),
        version: z.number().int().positive(),
        featureIds: z.array(z.string()),
        evidenceIds: z.array(z.string()),
        sourceStatus: z.enum(['pending', 'confirmed', 'review', 'excluded']),
        roleOrigin: z
          .object({ solutionId: z.string(), requirementId: z.string(), roleKey: z.string() })
          .optional(),
        importedFields: z.object({
          title: z.string(),
          text: z.string(),
          scope: z.string(),
          category: z.enum(['must', 'bonus', 'train', 'omit', 'unknown']),
          priority: z.enum(['high', 'medium', 'low']),
        }),
      })
      .optional(),
  })
  .strict();
export const changeFields = itemSchema.pick({
  title: true,
  text: true,
  scope: true,
  category: true,
  priority: true,
});
export const changeSchema = z
  .object({
    targetId: z.string(),
    targetKind: kindSchema,
    targetRevision: z.number().int().positive(),
    before: changeFields,
    after: changeFields,
    operation: z.enum(['update', 'exclude']),
    reason: z.string().min(1).max(3000),
    refs: z.array(refSchema),
    relatedIds: z.array(z.string()),
  })
  .strict();
export const suggestionSchema = z
  .object({
    suggestionId: z.string(),
    workspaceId: z.string(),
    baseRevision: z.number().int(),
    contextKey: z.string(),
    intent: z.string(),
    createdAt: z.string(),
    changes: z.array(changeSchema).min(1).max(30),
    preconditions: z.array(z.object({ targetId: z.string(), revision: z.number().int() })),
    status: z.enum(['pending', 'applied', 'rejected', 'stale', 'failed']),
    groupReason: z.string(),
    error: z.string(),
    requestId: z.string().optional(),
    promptVersion: z.string().optional(),
    contextSignature: z.string().optional(),
  })
  .strict();
export const questionSchema = z.object({
  ...decisionFields,
  response: decisionResponseSchema.optional(),
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  kind: z.enum(['potential', 'dependency', 'human']),
  important: z.boolean(),
  targetIds: z.array(z.string()),
  refs: z.array(refSchema),
  status: z.enum(['open', 'resolved', 'deferred', 'ignored']),
  answer: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});
const commentSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  replyTo: z.string().nullable(),
  author: z.string(),
  text: z.string().max(5000),
  createdAt: z.string(),
});
const operationSchema = z.object({
  questionsBefore: z.array(questionSchema).optional(),
  questionsAfter: z.array(questionSchema).optional(),
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
  before: z.array(itemSchema),
  after: z.array(itemSchema),
  suggestionId: z.string().nullable(),
  undone: z.boolean(),
});
const snapshotSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  createdAt: z.string(),
  items: z.array(itemSchema),
  sources: z.array(sourceSchema),
  questions: z.array(questionSchema),
  kind: z.enum(['confirmed', 'draft']),
  mode: z.enum(['example', 'real']),
});
export const workspaceSchema = z.object({
  demo: demoIdentitySchema.optional(),
  schemaVersion: z.literal(1),
  id: z.string(),
  revision: z.number().int().positive(),
  title: z.string().min(1).max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  example: z.boolean(),
  mode: z.enum(['example', 'real']),
  sources: z.array(sourceSchema).max(100),
  items: z.array(itemSchema).max(500),
  questions: z.array(questionSchema).max(300),
  suggestions: z.array(suggestionSchema).max(300),
  comments: z.array(commentSchema),
  operations: z.array(operationSchema),
  versions: z.array(snapshotSchema),
  activity: z.array(z.object({ id: z.string(), text: z.string(), at: z.string() })),
  aiHistory: z
    .array(
      z.object({
        requestId: z.string(),
        task: z.string(),
        promptVersion: z.string(),
        baseRevision: z.number(),
        at: z.string(),
        status: z.enum(['completed', 'failed', 'cancelled']),
      }),
    )
    .max(300)
    .optional(),
  researchImports: z.array(researchImportSchema).max(100).optional(),
  ui: z.object({
    view: z.enum(['tasks', 'jd']),
    objectTab: z.enum(['task', 'requirement']).default('task'),
    selectedId: z.string().nullable(),
    sourceId: z.string().nullable(),
    leftOpen: z.boolean(),
    rightOpen: z.boolean(),
    leftWidth: z.number().min(200).max(440).default(240),
    rightWidth: z.number().min(260).max(520).default(340),
    scrollTasks: z.number(),
    scrollJD: z.number(),
  }),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkItem = z.infer<typeof itemSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Reference = z.infer<typeof refSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type Change = z.infer<typeof changeSchema>;
export type Question = z.infer<typeof questionSchema>;
export type ItemKind = WorkItem['kind'];
export type ItemFields = z.infer<typeof changeFields>;
export const fields = (i: WorkItem): ItemFields => ({
  title: i.title,
  text: i.text,
  scope: i.scope,
  category: i.category,
  priority: i.priority,
});
export function newItem(kind: ItemKind, title: string, text = ''): WorkItem {
  return {
    id: uid(),
    kind,
    revision: 1,
    title,
    text,
    scope: '',
    priority: 'medium',
    category: 'must',
    status: 'pending',
    locked: false,
    refs: [],
    taskIds: [],
    requirementIds: [],
    origin: 'user',
    lastChange: now(),
  };
}
export function newWorkspace(title: string, example = false): Workspace {
  return {
    schemaVersion: 1,
    id: uid(),
    revision: 1,
    title,
    createdAt: now(),
    updatedAt: now(),
    example,
    mode: 'example',
    sources: [],
    items: [],
    questions: [],
    suggestions: [],
    comments: [],
    operations: [],
    versions: [],
    activity: [],
    ui: {
      view: 'tasks',
      objectTab: 'task',
      selectedId: null,
      sourceId: null,
      leftOpen: true,
      rightOpen: true,
      leftWidth: 240,
      rightWidth: 340,
      scrollTasks: 0,
      scrollJD: 0,
    },
  };
}
export const statusNames: Record<WorkItem['status'], string> = {
  pending: '待确认',
  confirmed: '已确认',
  excluded: '已排除',
  review: '需复核',
};
export const categoryNames: Record<WorkItem['category'], string> = {
  must: '必须具备',
  bonus: '加分项',
  train: '入职后培养',
  omit: '不纳入本岗位',
  unknown: '我不确定，暂不分类',
};
export const kindNames: Record<ItemKind, string> = {
  task: '任务',
  requirement: '要求',
  block: 'JD段落',
};
