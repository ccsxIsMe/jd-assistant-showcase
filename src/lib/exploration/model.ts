import { z } from 'zod';
import { demoIdentitySchema } from '../demo/identity';
import { decisionFields, decisionResponseSchema } from '../decisions/schema';
import { labSchema, labPatchSchema } from '../lab/model';
export const makeId = () => crypto.randomUUID();
export const timestamp = () => new Date().toISOString();
const id = z.string().min(1).max(120);
const short = z.string().max(300);
export const rectangleSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.001 && r.y + r.height <= 1.001, '标注超出原图');
export const paragraphSchema = z.object({
  id,
  text: z.string().min(1).max(2000),
  page: z.number().int().min(1).max(50).optional(),
  origin: z.enum(['user', 'extracted']),
});
export const sourceVersionSchema = z.object({
  revision: z.number().int().positive(),
  createdAt: z.string(),
  text: z.string().max(30000),
  paragraphs: z.array(paragraphSchema).max(120),
  assetId: id.optional(),
  fileName: short.optional(),
  mime: short.optional(),
  size: z.number().nonnegative().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  duration: z.number().min(0).max(600).optional(),
  pageCount: z.number().int().min(1).max(50).optional(),
  originalUrl: z.string().max(2000).optional(),
  normalizedUrl: z.string().max(2000).optional(),
  fetchedAt: z.string().optional(),
  updatedAt: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  screenshotStatus: z.enum(['not-available', 'user-provided']).optional(),
  userEdited: z.boolean().optional(),
});
export const exploreSourceSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  kind: z.enum(['url', 'text', 'document', 'image', 'video']),
  purpose: z.enum(['main', 'supplement', 'excluded', 'conflict']),
  borrow: z.string().max(2000),
  avoid: z.string().max(2000),
  referencePurpose: z.string().max(2000),
  status: z.enum(['idle', 'parsing', 'ready', 'partial', 'error']),
  error: z.string().max(2000),
  removed: z.boolean(),
  linkedSourceId: id.nullable(),
  createdAt: z.string(),
  versions: z.array(sourceVersionSchema).min(1).max(50),
});
export const locationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      paragraphId: id,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      page: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('image'), assetId: id, rect: rectangleSchema.nullable() }).strict(),
  z
    .object({
      kind: z.literal('document'),
      page: z.number().int().min(1).max(50),
      rect: rectangleSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('video'),
      time: z.number().min(0).max(600),
      frameAssetId: id.nullable(),
      rect: rectangleSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('unlocated'), reason: z.string().max(500) }).strict(),
]);
export const evidenceSchema = z.object({
  evidenceId: id,
  sourceId: id.nullable(),
  sourceRevision: z.number().int().positive().nullable(),
  evidenceType: z.enum([
    'web-text',
    'web-screenshot',
    'image',
    'document-text',
    'document-region',
    'video-frame',
    'video-time',
    'user-description',
    'ai-inference',
  ]),
  title: short,
  excerpt: z.string().max(3000),
  location: locationSchema,
  createdAt: z.string(),
  verificationStatus: z.enum(['verified', 'needs-review', 'unlocated']),
  relatedFindingIds: z.array(id).max(150),
});
export const overviewSchema = z.object({
  goal: z.string().max(3000),
  problem: z.string().max(3000),
  users: z.string().max(2000),
  outcome: z.string().max(2000),
  constraints: z.string().max(3000),
  evidenceIds: z.array(id).max(60),
  inferredFields: z.array(z.enum(['goal', 'problem', 'users', 'outcome', 'constraints'])).max(5),
});
export const findingSchema = z.object({
  id,
  revision: z.number().int().positive(),
  kind: z.enum(['goal', 'scenario', 'feature', 'condition', 'risk', 'conflict']),
  title: z.string().min(1).max(200),
  description: z.string().max(4000),
  behavior: z.string().max(2000),
  outcome: z.string().max(2000),
  basis: z.enum(['explicit', 'observed', 'inferred', 'excluded']),
  priority: z.enum(['high', 'medium', 'low']),
  phase: z.enum(['mvp', 'next', 'later']),
  status: z.enum(['pending', 'confirmed', 'excluded', 'review']),
  locked: z.boolean(),
  evidenceIds: z.array(id).max(60),
  parentId: id.nullable(),
  origin: z.enum(['user', 'ai']),
  analysisMode: z.enum(['example', 'real']).optional(),
  rationale: z.string().max(3000).optional(),
  uncertainty: z.string().max(2000).optional(),
});
export const exploreQuestionSchema = z.object({
  ...decisionFields,
  response: decisionResponseSchema.optional(),
  id,
  title: z.string().min(1).max(300),
  detail: z.string().max(3000),
  findingIds: z.array(id).max(40),
  evidenceIds: z.array(id).max(40),
  status: z.enum(['open', 'answered', 'deferred', 'excluded']),
  answer: z.string().max(4000),
});
export const analysisOutputSchema = z
  .object({
    overview: overviewSchema,
    findings: z
      .array(
        findingSchema
          .omit({
            id: true,
            revision: true,
            status: true,
            locked: true,
            parentId: true,
            origin: true,
            analysisMode: true,
          })
          .extend({ key: id, parentKey: id.nullable() })
          .strict(),
      )
      .max(40),
    questions: z
      .array(
        exploreQuestionSchema
          .omit({ id: true, findingIds: true, status: true, answer: true, response: true })
          .extend({ findingKeys: z.array(id).max(40) })
          .strict(),
      )
      .max(30),
    notice: z.string().max(2000),
  })
  .strict();
export const analysisRunSchema = z.object({
  id,
  at: z.string(),
  requestId: id,
  promptVersion: short,
  mode: z.enum(['example', 'real']),
  baseSignature: z.string(),
  output: analysisOutputSchema,
  applied: z.boolean(),
  modelConfig: z
    .object({
      provider: z.string().max(100),
      model: z.string().max(200),
      configurationId: z.string().max(100),
    })
    .optional(),
  parserVersions: z.record(z.string(), z.string()).optional(),
});
export const researchPatchSchema = z.object({
  findings: z.array(findingSchema),
  sources: z.array(exploreSourceSchema),
  evidence: z.array(evidenceSchema),
  questions: z.array(exploreQuestionSchema),
  overview: overviewSchema.optional(),
  overviewConfirmed: z.boolean().optional(),
  overviewRevision: z.number().optional(),
  lab: labPatchSchema.optional(),
});
export const researchOperationSchema = z.object({
  id,
  label: z.string().max(500),
  at: z.string(),
  before: researchPatchSchema,
  after: researchPatchSchema,
  undone: z.boolean(),
  undoneAt: z.string().optional(),
  redoable: z.boolean().optional(),
});
export const transferEventSchema = z.object({
  id,
  snapshotId: id,
  kind: z.enum(['archive-export', 'material-export', 'workbench-import', 'upstream-sync']),
  at: z.string(),
  workspaceId: id.optional(),
  version: z.number().int().positive(),
});
export const researchStateSchema = z.object({
  demo: demoIdentitySchema.optional(),
  originalObjective: z.string().max(30000),
  capturedRevision: z.number().int().positive(),
  signature: z.string(),
  overview: overviewSchema,
  overviewConfirmed: z.boolean(),
  overviewRevision: z.number().int().positive(),
  overviewMode: z.enum(['manual', 'example', 'real']),
  findings: z.array(findingSchema).max(150),
  sources: z.array(exploreSourceSchema).max(40),
  evidence: z.array(evidenceSchema).max(600),
  questions: z.array(exploreQuestionSchema).max(100),
  runs: z.array(analysisRunSchema).max(100),
  operations: z.array(researchOperationSchema).max(2000),
  activity: z.array(z.object({ id, text: z.string().max(1000), at: z.string() })).max(300),
  transfers: z.array(transferEventSchema).max(1000),
  parserVersions: z.record(z.string(), z.string()),
  archive: z.object({
    assetIds: z.array(id).max(2500),
    missingAssetIds: z.array(id).max(2500),
    limitations: z.array(z.string().max(1000)).max(100),
  }),
  lab: labSchema.optional(),
});
export const snapshotSchema = z
  .object({
    format: z.literal('product-requirements-snapshot'),
    schemaVersion: z.literal(1),
    snapshotId: id,
    explorationId: id,
    version: z.number().int().positive(),
    title: z.string().min(1).max(200),
    createdAt: z.string(),
    mode: z.enum(['example', 'real']),
    kind: z.enum(['draft', 'confirmed']),
    overview: overviewSchema,
    findings: z.array(findingSchema).max(150),
    questions: z.array(exploreQuestionSchema).max(100),
    sources: z.array(exploreSourceSchema).max(40),
    evidence: z.array(evidenceSchema).max(600),
    importedFrom: id.optional(),
    updatedAt: z.string().optional(),
    lineage: z
      .object({
        rootSnapshotId: id,
        parentSnapshotId: id.nullable(),
        copiedFromSnapshotId: id.nullable(),
      })
      .optional(),
    research: researchStateSchema.optional(),
  })
  .strict();
export const explorationSchema = z.object({
  demo: demoIdentitySchema.optional(),
  trashedAt: z.iso.datetime().nullable().optional(),
  schemaVersion: z.literal(1),
  id,
  title: z.string().min(1).max(200),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mode: z.enum(['example', 'real']),
  sources: z.array(exploreSourceSchema).max(40),
  evidence: z.array(evidenceSchema).max(600),
  findings: z.array(findingSchema).max(150),
  overview: overviewSchema,
  overviewRevision: z.number().int().positive(),
  overviewConfirmed: z.boolean(),
  overviewMode: z.enum(['manual', 'example', 'real']).default('manual'),
  questions: z.array(exploreQuestionSchema).max(100),
  runs: z.array(analysisRunSchema).max(100),
  snapshots: z.array(snapshotSchema).max(20),
  exportedSnapshotIds: z.array(id).max(40),
  initialObjective: z.string().max(30000).optional(),
  baseSnapshotId: id.optional(),
  lineageRootId: id.optional(),
  copiedFromSnapshotId: id.optional(),
  operations: z.array(researchOperationSchema).max(2000).optional(),
  transfers: z.array(transferEventSchema).max(1000).optional(),
  lab: labSchema.optional(),
  activity: z.array(z.object({ id, text: z.string().max(1000), at: z.string() })).max(300),
  ui: z.object({
    sourceId: id.nullable(),
    evidenceId: id.nullable(),
    findingId: id.nullable(),
    view: z.enum([
      'overview',
      'features',
      'evidence',
      'conflicts',
      'questions',
      'risks',
      'structure',
    ]),
    leftOpen: z.boolean(),
    rightOpen: z.boolean(),
    leftWidth: z.number().min(200).max(440),
    rightWidth: z.number().min(260).max(520),
    returnView: z
      .enum(['overview', 'features', 'evidence', 'conflicts', 'questions', 'risks', 'structure'])
      .optional(),
  }),
});
export type Exploration = z.infer<typeof explorationSchema>;
export type ExploreSource = z.infer<typeof exploreSourceSchema>;
export type SourceVersion = z.infer<typeof sourceVersionSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type AnalysisRun = z.infer<typeof analysisRunSchema>;
export type Rectangle = z.infer<typeof rectangleSchema>;
export type ResearchState = z.infer<typeof researchStateSchema>;
export type ResearchPatch = z.infer<typeof researchPatchSchema>;
export const emptyOverview = (): Exploration['overview'] => ({
  goal: '',
  problem: '',
  users: '',
  outcome: '',
  constraints: '',
  evidenceIds: [],
  inferredFields: [],
});
export function newExploration(title: string): Exploration {
  return {
    schemaVersion: 1,
    id: makeId(),
    title: title.trim() || '未命名产品探索',
    revision: 1,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    mode: 'example',
    sources: [],
    evidence: [],
    findings: [],
    overview: emptyOverview(),
    overviewRevision: 1,
    overviewConfirmed: false,
    overviewMode: 'manual',
    questions: [],
    runs: [],
    snapshots: [],
    exportedSnapshotIds: [],
    activity: [],
    ui: {
      sourceId: null,
      evidenceId: null,
      findingId: null,
      view: 'overview',
      leftOpen: true,
      rightOpen: true,
      leftWidth: 260,
      rightWidth: 340,
    },
  };
}
export const sourceKindNames = {
  url: '公开网页',
  text: '想法描述',
  document: '文档',
  image: '图片 / 截图',
  video: 'MP4视频',
};
export const purposeNames = {
  main: '主要参考',
  supplement: '补充说明',
  excluded: '反例 / 不需要',
  conflict: '冲突待核实',
};
export const parseNames = {
  idle: '尚未解析',
  parsing: '正在解析',
  ready: '解析完成',
  partial: '部分完成',
  error: '解析失败',
};
export const basisNames = {
  explicit: '用户明确提出',
  observed: '资料中观察到',
  inferred: '推断待确认',
  excluded: '明确不借鉴',
};
export const findingKindNames = {
  goal: '产品目标',
  scenario: '用户场景',
  feature: '功能需求',
  condition: '实施条件',
  risk: '风险与推断',
  conflict: '来源冲突',
};
