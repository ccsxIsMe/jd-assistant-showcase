import { z } from 'zod';
import { demoIdentitySchema } from '../demo/identity';
const id = z.string().min(1).max(200);
export const materialStates = ['explicit', 'insufficient', 'not_found', 'inconsistent'] as const;
export const materialStateSchema = z.enum(materialStates);
export const materialStateNames = {
  explicit: '有明确描述',
  insufficient: '描述不足',
  not_found: '未找到描述',
  inconsistent: '材料存在不一致',
};
export const standardRequirementSchema = z
  .object({
    id,
    title: z.string().min(1).max(300),
    text: z.string().min(1).max(3000),
    category: z.enum(['must', 'bonus', 'train', 'unknown']),
    status: z.enum(['pending', 'confirmed', 'review']),
    sourceRevision: z.number().int().positive(),
    refs: z
      .array(
        z
          .object({
            sourceId: id,
            sourceRevision: z.number().int().positive(),
            excerpt: z.string().max(3000),
          })
          .strict(),
      )
      .max(30),
    origin: z
      .object({ snapshotId: id, featureIds: z.array(id), evidenceIds: z.array(id) })
      .strict()
      .optional(),
  })
  .strict();
export const standardSchema = z
  .object({
    id,
    workspaceId: id.nullable(),
    title: z.string().min(1).max(200),
    kind: z.enum(['workspace-draft', 'workspace-version', 'direct-jd']),
    workspaceRevision: z.number().int().positive(),
    jdVersionId: id.nullable(),
    versionNumber: z.number().int().positive().nullable(),
    jd: z.string().max(50000),
    requirements: z.array(standardRequirementSchema).min(1).max(80),
    capturedAt: z.string(),
    signature: z.string().min(1).max(200),
    limitations: z.array(z.string().max(2000)).max(20),
  })
  .strict()
  .refine(
    (s) => new Set(s.requirements.map((r) => r.id)).size === s.requirements.length,
    '岗位要求ID重复，未采用数据。',
  );
export const materialSchema = z
  .object({
    id,
    revision: z.number().int().positive(),
    text: z.string().max(30000),
    fileName: z.string().max(300),
    parser: z.enum(['pasted', 'pdfjs', 'mammoth', 'demo']),
  })
  .strict();
export const resumeEvidenceSchema = z
  .object({ paragraphId: id, quote: z.string().trim().min(1).max(3000) })
  .strict();
export const resumeOutputSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    assessments: z
      .array(
        z
          .object({
            requirementId: id,
            state: materialStateSchema,
            explanation: z.string().min(1).max(2000),
            evidence: z.array(resumeEvidenceSchema).max(8),
            questions: z.array(z.string().min(1).max(1000)).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(80),
  })
  .strict();
export const resumeRequestSchema = z
  .object({
    sessionId: id,
    mode: z.enum(['example', 'real']),
    standard: standardSchema,
    material: materialSchema,
    consent: z.literal(true),
    fixture: z.enum(['paperboat@1', 'software-engineer@1']).optional(),
  })
  .strict();
export const reportSchema = z
  .object({
    id,
    requestId: id,
    createdAt: z.string(),
    mode: z.enum(['example', 'real']),
    standard: standardSchema,
    material: materialSchema,
    materialSignature: id,
    data: resumeOutputSchema,
    promptVersion: z.string().max(100),
    modelConfigId: z.string().max(150),
  })
  .strict();
export const correctionSchema = z
  .object({
    id,
    reportId: id,
    requirementId: id,
    standardSignature: id,
    materialSignature: id,
    before: materialStateSchema,
    after: materialStateSchema,
    reason: z.string().trim().min(1).max(2000),
    createdAt: z.string(),
    undoneAt: z.string().optional(),
  })
  .strict();
export const reviewSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    workspaceId: id.nullable(),
    title: z.string().max(200),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.number().int().positive(),
    standard: standardSchema,
    material: materialSchema,
    mode: z.enum(['example', 'real']),
    reports: z.array(reportSchema).max(50),
    corrections: z.array(correctionSchema).max(1000),
    demo: demoIdentitySchema.optional(),
  })
  .strict();
export type Standard = z.infer<typeof standardSchema>;
export type StandardRequirement = z.infer<typeof standardRequirementSchema>;
export type ResumeMaterial = z.infer<typeof materialSchema>;
export type ResumeOutput = z.infer<typeof resumeOutputSchema>;
export type ResumeRequest = z.infer<typeof resumeRequestSchema>;
export type ResumeReport = z.infer<typeof reportSchema>;
export type ReviewSession = z.infer<typeof reviewSessionSchema>;
export type Correction = z.infer<typeof correctionSchema>;
