import { z } from 'zod';
import { demoIdentitySchema } from '../demo/identity';
import { roleSolutionSchema, roleRequirementSchema } from '../lab/model';
import {
  findingSchema,
  exploreQuestionSchema,
  exploreSourceSchema,
  evidenceSchema,
  overviewSchema,
} from './model';
const id = z.string().min(1).max(120);
export const requirementMaterialSchema = z
  .object({
    demo: demoIdentitySchema.optional(),
    format: z.literal('product-requirements-material'),
    schemaVersion: z.literal(1),
    snapshotId: id,
    explorationId: id,
    lineageRootId: id,
    snapshotVersion: z.number().int().positive(),
    title: z.string().min(1).max(200),
    objective: z.string().max(3000),
    targetUsers: z.string().max(2000),
    overview: overviewSchema,
    scenarios: z.array(findingSchema).max(150),
    features: z.array(findingSchema).max(150),
    structureNodes: z.array(findingSchema).max(150).optional(),
    constraints: z.array(z.string().max(4000)).max(160),
    openQuestions: z.array(exploreQuestionSchema).max(100),
    evidenceRefs: z.array(id).max(600),
    assumptions: z.array(findingSchema).max(150),
    confirmedItems: z.array(id).max(150),
    unconfirmedItems: z.array(id).max(150),
    sourceManifest: z
      .array(
        z
          .object({
            sourceId: id,
            revision: z.number().int().positive(),
            title: z.string().max(200),
            kind: exploreSourceSchema.shape.kind,
            status: exploreSourceSchema.shape.status,
            url: z.string().max(2000),
            fetchedAt: z.string(),
            removed: z.boolean(),
          })
          .strict(),
      )
      .max(40),
    sourceRecords: z.array(exploreSourceSchema).max(40),
    evidenceRecords: z.array(evidenceSchema).max(600),
    createdAt: z.string(),
    exportedAt: z.string(),
    mode: z.enum(['example', 'real']),
    modeNotice: z.enum(['演示数据，非真实AI分析', '真实AI候选，仍需人工核实']).optional(),
    fixtureNotice: z.string().max(200).optional(),
    snapshotKind: z.enum(['draft', 'confirmed']),
    archiveLimitations: z.array(z.string().max(1000)).max(100),
    roleData: z
      .object({
        solutions: z.array(roleSolutionSchema).max(30),
        requirements: z.array(roleRequirementSchema).max(300),
        selectedSolutionIds: z.array(id).max(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export const researchImportSchema = z.object({
  id,
  snapshotId: id,
  lineageRootId: id,
  explorationId: id,
  importedAt: z.string(),
  material: requirementMaterialSchema,
  versions: z.array(requirementMaterialSchema).max(20).optional(),
});
export type RequirementMaterial = z.infer<typeof requirementMaterialSchema>;
export type ResearchImport = z.infer<typeof researchImportSchema>;
