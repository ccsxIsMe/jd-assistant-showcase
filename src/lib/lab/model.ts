import { z } from 'zod';
import { visionOutputSchema } from './vision-contract';
const id = z.string().min(1).max(160);
const text = z.string().max(4000);
export const nodeTypes = [
  'source',
  'evidence',
  'feature',
  'inference',
  'question',
  'role',
  'requirement',
] as const;
export const relationTypes = [
  'derived_from',
  'supports',
  'inferred_from',
  'related_to',
  'weakly_related',
  'implies',
  'depends_on',
  'conflicts_with',
  'addresses',
  'maps_to',
  'contains',
] as const;
export const originSchema = z.enum([
  'source_fact',
  'user_confirmed',
  'ai_inference',
  'user_provided',
]);
export const positionSchema = z
  .object({
    x: z.number().finite().min(-50000).max(50000),
    y: z.number().finite().min(-50000).max(50000),
  })
  .strict();
const geometrySchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.001 && r.y + r.height <= 1.001, '标注超出原图');
const base = {
  id,
  projectId: id,
  title: z.string().min(1).max(200),
  summary: z.string().max(800),
  sourceIds: z.array(id).max(40),
  evidenceIds: z.array(id).max(600),
  originType: originSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().positive(),
  layoutPosition: positionSchema,
  collapsed: z.boolean(),
  userPositioned: z.boolean(),
  acceptedByUser: z.boolean(),
};
const findingContent = z
  .object({
    findingId: id,
    basis: z.enum(['explicit', 'observed', 'inferred', 'excluded']),
    description: text,
    rationale: z.string().max(3000),
    uncertainty: z.string().max(2000),
    findingKind: z.enum(['goal', 'scenario', 'feature', 'condition', 'risk', 'conflict']),
  })
  .strict();
const decision = z.enum(['pending', 'confirmed', 'excluded', 'review', 'stale']);
export const graphNodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('source'),
      status: z.enum(['parsing', 'ready', 'partial', 'failed', 'excluded', 'review']),
      content: z
        .object({
          sourceId: id,
          sourceType: z.enum(['url', 'text', 'image', 'document', 'video']),
          sourceRevision: z.number().int().positive(),
          parseStatus: z.string().max(80),
          preview: text,
          limitations: z.string().max(2000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('evidence'),
      status: z.enum(['pending', 'verified', 'review', 'stale', 'excluded']),
      content: z
        .object({
          evidenceId: id,
          sourceId: id,
          sourceRevision: z.number().int().positive(),
          locatorKind: z.enum(['text', 'image', 'document', 'video', 'unlocated']),
          excerpt: z.string().max(3000),
          independent: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ ...base, type: z.literal('feature'), status: decision, content: findingContent })
    .strict(),
  z
    .object({ ...base, type: z.literal('inference'), status: decision, content: findingContent })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('question'),
      status: z.enum(['open', 'answered', 'deferred', 'excluded', 'review']),
      content: z.object({ questionId: id, detail: z.string().max(3000), answer: text }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('role'),
      status: decision,
      content: z
        .object({
          solutionId: id,
          roleKey: id,
          description: text,
          rationale: text,
          assumptions: z.array(z.string().max(1000)).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('requirement'),
      status: decision,
      content: z
        .object({
          requirementId: id,
          solutionId: id,
          requirementType: z.enum(['must', 'bonus', 'trainable', 'pending']),
          description: text,
          locked: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);
export const graphEdgeSchema = z
  .object({
    id,
    projectId: id,
    sourceNodeId: id,
    targetNodeId: id,
    relationType: z.enum(relationTypes),
    strengthClass: z.enum(['strong', 'weak', 'conflict']),
    status: z.enum(['pending', 'verified', 'review', 'deleted', 'restored', 'stale']),
    evidenceRefs: z.array(id).max(60),
    generatedBy: z.enum(['program', 'ai', 'user', 'example']),
    rationale: text,
    uncertainty: z.string().max(2000),
    leftEvidenceIds: z.array(id).max(30),
    rightEvidenceIds: z.array(id).max(30),
    inputFingerprint: z.string().max(10000),
    reconsiderationAvailable: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.number().int().positive(),
    deletedAt: z.string().optional(),
    deletedBy: z.literal('user').optional(),
    verifiedByUser: z.boolean().default(false),
  })
  .strict();
export const annotationSchema = z
  .object({
    id,
    projectId: id,
    evidenceId: id,
    sourceId: id,
    sourceRevision: z.number().int().positive(),
    shapeType: z.literal('rectangle'),
    normalizedGeometry: geometrySchema,
    label: z.string().min(1).max(2000),
    status: z.enum(['pending', 'accepted', 'deleted', 'stale']),
    createdBy: z.enum(['ai', 'user', 'example']),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.number().int().positive(),
    assetId: id.optional(),
    originalWidth: z.number().positive().max(20000),
    originalHeight: z.number().positive().max(20000),
    page: z.number().int().min(1).max(50).optional(),
    time: z.number().min(0).max(600).optional(),
  })
  .strict();
export const roleRequirementSchema = z
  .object({
    id,
    projectId: id,
    solutionId: id,
    roleKey: id,
    title: z.string().min(1).max(200),
    description: text,
    requirementType: z.enum(['must', 'bonus', 'trainable', 'pending']),
    relatedTaskIds: z.array(id).max(150),
    relatedFeatureIds: z.array(id).max(150),
    evidenceIds: z.array(id).max(60),
    inferenceIds: z.array(id).max(150),
    status: decision,
    locked: z.boolean(),
    revision: z.number().int().positive(),
    originType: z.literal('ai_inference'),
    rationale: text,
    uncertainty: z.string().max(2000),
    createdAt: z.string(),
    updatedAt: z.string(),
    inputVersions: z.record(z.string(), z.number()).default({}),
  })
  .strict();
export const roleSolutionSchema = z
  .object({
    hiringNeed: z.enum(['not-needed', 'candidate', 'unknown']).optional(),
    id,
    projectId: id,
    title: z.string().min(1).max(200),
    description: text,
    rationale: text,
    assumptions: z.array(z.string().max(1000)).max(20),
    advantages: z.array(z.string().max(1000)).max(20),
    disadvantages: z.array(z.string().max(1000)).max(20),
    openQuestions: z.array(z.string().max(1000)).max(20),
    relatedFeatureIds: z.array(id).max(150),
    relatedEvidenceIds: z.array(id).max(60),
    productPlan: z
      .object({
        goal: z.string().max(2000),
        priorityFeatureIds: z.array(id).max(150),
        deferredFeatureIds: z.array(id).max(150),
        difference: z.string().max(2000),
        complexity: z.string().max(1000),
        capabilityNotes: z.array(z.string().max(1000)).max(10),
      })
      .strict()
      .optional(),
    roles: z
      .array(
        z
          .object({
            key: id,
            title: z.string().min(1).max(200),
            headcount: z.number().int().min(1).max(50).nullable(),
            rationale: text,
          })
          .strict(),
      )
      .min(1)
      .max(10),
    status: decision,
    revision: z.number().int().positive(),
    generatedBy: z.enum(['ai', 'example', 'user']),
    createdAt: z.string(),
    updatedAt: z.string(),
    inputVersions: z.record(z.string(), z.number()).default({}),
  })
  .strict();
export const stages = [
  'parse_sources',
  'extract_evidence',
  'derive_features',
  'link_evidence',
  'propose_roles',
] as const;
export const stageRunSchema = z
  .object({
    id,
    projectId: id,
    stage: z.enum(stages),
    status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'stale']),
    inputRevision: z.number().int().positive(),
    inputVersions: z.record(z.string(), z.string()),
    inputSignature: z.string().max(30000),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    errorCode: z.string().max(80),
    errorMessage: z.string().max(2000),
    retryCount: z.number().int().min(0).max(1),
    promptVersion: z.string().max(100),
    modelConfigId: z.string().max(120),
    resultRevision: z.number().int().positive().optional(),
    requestId: id.optional(),
    scopeNodeIds: z.array(id).max(1200),
    resultSummary: z.string().max(1000),
    planningSignature: z.string().optional(),
  })
  .strict();
export const labBusinessSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(graphNodeSchema).max(1200),
    edges: z.array(graphEdgeSchema).max(4000),
    annotations: z.array(annotationSchema).max(600),
    solutions: z.array(roleSolutionSchema).max(30),
    requirements: z.array(roleRequirementSchema).max(300),
    activeSolutionIds: z.array(id).max(10),
    pinnedEvidenceIds: z.array(id).max(600),
    embeddedEvidenceIds: z.array(id).max(600).default([]),
    runs: z.array(stageRunSchema).max(300),
    researchGuide: z
      .object({
        sourceSignature: z.string().nullable(),
        sourceConfirmedAt: z.string().nullable(),
        evidenceSignature: z.string().nullable(),
        evidenceReviewedAt: z.string().nullable(),
        importRequirementIds: z.array(id).max(300),
        planChoice: z
          .object({
            kind: z.enum(['selected', 'custom', 'uncertain', 'none']),
            text: z.string().max(3000),
          })
          .strict()
          .optional(),
        acknowledgedConflicts: z.string().optional(),
        packageSignature: z.string().optional(),
      })
      .strict()
      .default({
        sourceSignature: null,
        sourceConfirmedAt: null,
        evidenceSignature: null,
        evidenceReviewedAt: null,
        importRequirementIds: [],
      }),
    visualResults: z
      .array(
        z
          .object({
            id,
            sourceId: id,
            sourceRevision: z.number().int().positive(),
            requestId: id,
            promptVersion: z.string().max(100),
            mode: z.enum(['example', 'real']),
            createdAt: z.string(),
            output: visionOutputSchema,
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict();
export const labSchema = labBusinessSchema
  .extend({
    ui: z
      .object({
        viewport: z
          .object({
            x: z.number().finite(),
            y: z.number().finite(),
            zoom: z.number().min(0.1).max(3),
          })
          .strict(),
        selectedNodeId: id.nullable(),
        selectedEdgeId: id.nullable(),
        focusedRequirementId: id.nullable(),
        rightOpen: z.boolean(),
        rightWidth: z.number().min(300).max(600),
        filters: z
          .object({
            types: z.array(z.enum(nodeTypes)).max(7),
            relations: z.array(z.enum(relationTypes)).max(11),
            status: z.string().max(40),
          })
          .strict(),
        guided: z.boolean(),
        evidenceViewed: z.boolean().default(false),
        researchView: z.enum(['guided', 'board']).default('guided'),
        researchMode: z.enum(['plan', 'collaborate']).default('collaborate'),
        planningScreen: z.enum(['input', 'results', 'handoff']).default('input'),
        researchStep: z
          .enum(['materials', 'evidence', 'requirements', 'roles', 'handoff'])
          .default('materials'),
        boardDensity: z.enum(['core', 'all']).default('core'),
        focusTarget: z
          .object({ kind: z.enum(['node', 'edge']), id })
          .strict()
          .nullable()
          .default(null),
      })
      .strict(),
  })
  .strict();
export const labPatchSchema = z
  .object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
    annotations: z.array(annotationSchema),
    solutions: z.array(roleSolutionSchema),
    requirements: z.array(roleRequirementSchema),
    activeSolutionIds: z.array(id).optional(),
    pinnedEvidenceIds: z.array(id).optional(),
    embeddedEvidenceIds: z.array(id).optional(),
    // A partial history patch must not materialize business-state defaults.
    researchGuide: labBusinessSchema.shape.researchGuide.removeDefault().optional(),
  })
  .strict();
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type RoleSolution = z.infer<typeof roleSolutionSchema>;
export type RoleRequirement = z.infer<typeof roleRequirementSchema>;
export type LabState = z.infer<typeof labSchema>;
export type LabPatch = z.infer<typeof labPatchSchema>;
export type StageRun = z.infer<typeof stageRunSchema>;
export type LabStage = (typeof stages)[number];
export const nodeTypeNames = {
  source: '原始资料',
  evidence: '独立证据',
  feature: '产品功能',
  inference: 'AI推断',
  question: '待确认问题',
  role: '候选岗位',
  requirement: '岗位要求',
};
export const relationNames: Record<GraphEdge['relationType'], string> = {
  derived_from: '来源于',
  supports: '支持',
  inferred_from: '推断依据',
  related_to: '相关',
  weakly_related: '弱关联',
  implies: '推导出',
  depends_on: '依赖',
  conflicts_with: '冲突待核实',
  addresses: '回应问题',
  maps_to: '映射要求',
  contains: '包含',
};
export const requirementTypeNames = {
  must: '必要条件',
  bonus: '加分项',
  trainable: '可培养',
  pending: '尚未确认',
};
export const stageNames = {
  parse_sources: '解析资料',
  extract_evidence: '提取证据',
  derive_features: '形成需求',
  link_evidence: '关联证据',
  propose_roles: '提出岗位方案',
};
export function emptyLab(): LabState {
  return {
    schemaVersion: 1,
    nodes: [],
    edges: [],
    annotations: [],
    solutions: [],
    requirements: [],
    activeSolutionIds: [],
    pinnedEvidenceIds: [],
    embeddedEvidenceIds: [],
    runs: [],
    researchGuide: {
      sourceSignature: null,
      sourceConfirmedAt: null,
      evidenceSignature: null,
      evidenceReviewedAt: null,
      importRequirementIds: [],
    },
    visualResults: [],
    ui: {
      viewport: { x: 25, y: 75, zoom: 0.85 },
      selectedNodeId: null,
      selectedEdgeId: null,
      focusedRequirementId: null,
      rightOpen: true,
      rightWidth: 360,
      filters: { types: [], relations: [], status: 'all' },
      guided: false,
      evidenceViewed: false,
      researchView: 'guided',
      researchMode: 'collaborate',
      planningScreen: 'input',
      researchStep: 'materials',
      boardDensity: 'core',
      focusTarget: null,
    },
  };
}
