import { z } from 'zod';
import { analysisRequestSchema } from '../exploration/analysis';
import { analysisOutputSchema } from '../exploration/model';
import { nodeTypes, relationTypes } from './model';
import type { ValidationIssue } from '../ai/validation';
import { decisionFields } from '../decisions/schema';
import { roleSolutionSchema } from './model';
export class LabContractError extends Error {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}
const id = z.string().min(1).max(160);
const text = z.string().max(4000);
const lines = z.array(z.string().max(1000)).max(20);
export const aiStages = ['derive_features', 'link_evidence', 'propose_roles'] as const;
export const labPromptVersions = {
  derive_features: 'lab.derive_features@1.5.0',
  link_evidence: 'lab.link_evidence@1.3.0',
  propose_roles: 'lab.propose_roles@1.5.0',
} as const;
export const endpointSchema = z
  .object({
    id,
    type: z.enum(nodeTypes),
    title: z.string().max(200),
    summary: z.string().max(800),
    sourceIds: z.array(id).max(40),
    evidenceIds: z.array(id).max(600),
    originType: z.enum(['source_fact', 'user_confirmed', 'ai_inference', 'user_provided']),
    status: z.string().max(40),
  })
  .strict();
export const labStageRequestSchema = z
  .object({
    stage: z.enum(aiStages),
    interactionMode: z.enum(['plan', 'collaborate']).default('collaborate'),
    projectId: id,
    revision: z.number().int().positive(),
    mode: z.enum(['example', 'real']),
    consent: z.literal(true),
    analysis: analysisRequestSchema,
    nodes: z.array(endpointSchema).max(1200),
    scope: z.object({ kind: z.enum(['all', 'selected']), nodeIds: z.array(id).max(1200) }).strict(),
    deletedRelations: z
      .array(
        z
          .object({ sourceNodeId: id, targetNodeId: id, relationType: z.enum(relationTypes) })
          .strict(),
      )
      .max(1000),
    inputVersions: z.record(z.string(), z.string()),
  })
  .strict();
export type LabStageRequest = z.infer<typeof labStageRequestSchema>;
export const relationProposalSchema = z
  .object({
    sourceNodeId: id,
    targetNodeId: id,
    relationType: z.enum(relationTypes),
    evidenceRefs: z.array(id).max(60),
    leftEvidenceIds: z.array(id).max(30),
    rightEvidenceIds: z.array(id).max(30),
    rationale: z.string().min(1).max(4000),
    uncertainty: z.string().max(2000),
  })
  .strict();
const question = z
  .object({
    ...decisionFields,
    title: z.string().min(1).max(300),
    detail: z.string().max(3000),
    findingIds: z.array(id).max(40),
    evidenceIds: z.array(id).max(40),
  })
  .strict();
export const linkOutputSchema = z
  .object({
    relations: z.array(relationProposalSchema).max(150),
    questions: z.array(question).max(30),
    notice: z.string().max(2000),
  })
  .strict();
const requirement = z
  .object({
    key: id,
    roleKey: id,
    title: z.string().min(1).max(200),
    description: text,
    requirementType: z.enum(['must', 'bonus', 'trainable', 'pending']),
    relatedFeatureIds: z.array(id).max(150),
    evidenceIds: z.array(id).max(60),
    inferenceIds: z.array(id).max(150),
    rationale: z.string().min(1).max(4000),
    uncertainty: z.string().max(2000),
  })
  .strict();
export const roleOutputSchema = z
  .object({
    solutions: z
      .array(
        z
          .object({
            key: id,
            title: z.string().min(1).max(200),
            description: text,
            rationale: z.string().min(1).max(4000),
            assumptions: lines,
            advantages: lines,
            disadvantages: lines,
            openQuestions: lines,
            relatedFeatureIds: z.array(id).max(150),
            relatedEvidenceIds: z.array(id).max(60),
            productPlan: roleSolutionSchema.shape.productPlan,
            hiringNeed: roleSolutionSchema.shape.hiringNeed,
            roles: z
              .array(
                z
                  .object({
                    key: z.string().min(1).max(60),
                    title: z.string().min(1).max(200),
                    headcount: z.number().int().min(1).max(50).nullable(),
                    rationale: text,
                  })
                  .strict(),
              )
              .min(1)
              .max(10),
            requirements: z.array(requirement).max(40),
          })
          .strict(),
      )
      .max(5),
    questions: z.array(question).max(30),
    notice: z.string().max(2000),
  })
  .strict();
export type LinkOutput = z.infer<typeof linkOutputSchema>;
export type RoleOutput = z.infer<typeof roleOutputSchema>;
export type RelationProposal = z.infer<typeof relationProposalSchema>;
export const labResultSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('derive_features'), output: analysisOutputSchema }).strict(),
  z.object({ stage: z.literal('link_evidence'), output: linkOutputSchema }).strict(),
  z.object({ stage: z.literal('propose_roles'), output: roleOutputSchema }).strict(),
]);
export type LabResult = z.infer<typeof labResultSchema>;
export function validateLabRequest(raw: unknown) {
  const input = labStageRequestSchema.parse(raw);
  if (input.projectId !== input.analysis.projectId || input.mode !== input.analysis.mode)
    throw new LabContractError('分析上下文不属于本研究或模式不一致。');
  const ids = new Set(input.nodes.map((n) => n.id));
  if (ids.size !== input.nodes.length || input.scope.nodeIds.some((id) => !ids.has(id)))
    throw new LabContractError('分析范围包含不存在的节点。');
  return input;
}
export function validateLinkResult(input: LabStageRequest, raw: unknown): LinkOutput {
  const out = linkOutputSchema.parse(raw);
  const nodes = new Set(input.nodes.map((n) => n.id)),
    evidence = new Set(input.analysis.evidence.map((e) => e.evidenceId));
  for (const r of out.relations) {
    if (
      !nodes.has(r.sourceNodeId) ||
      !nodes.has(r.targetNodeId) ||
      r.sourceNodeId === r.targetNodeId
    )
      throw new LabContractError('关系端点不属于允许范围。');
    if (
      input.scope.kind === 'selected' &&
      ![r.sourceNodeId, r.targetNodeId].some((id) => input.scope.nodeIds.includes(id))
    )
      throw new LabContractError('关系超出本次选中范围。');
    if (
      [...r.evidenceRefs, ...r.leftEvidenceIds, ...r.rightEvidenceIds].some(
        (id) => !evidence.has(id),
      )
    )
      throw new LabContractError('关系引用不存在的证据。');
    if (
      r.relationType === 'conflicts_with' &&
      (!r.leftEvidenceIds.length ||
        !r.rightEvidenceIds.length ||
        r.leftEvidenceIds.every((id) => r.rightEvidenceIds.includes(id)))
    )
      throw new LabContractError('冲突必须有分别可核对的双方依据。');
  }
  validateQuestionReferences(input, out.questions);
  return out;
}
function validateQuestionReferences(input: LabStageRequest, questions: LinkOutput['questions']) {
  const findings = new Set(input.analysis.confirmedFindings.map((f) => f.id)),
    evidence = new Set(input.analysis.evidence.map((e) => e.evidenceId));
  const issues: ValidationIssue[] = [];
  for (const [index, q] of questions.entries()) {
    // Missing/duplicate options are a per-question failure, not a reason to rerun relations.
    for (const [i, id] of q.findingIds.entries())
      if (!findings.has(id))
        issues.push({
          code: 'UNKNOWN_FINDING_REFERENCE',
          path: `questions[${index}].findingIds[${i}]`,
          message:
            '问题只能引用本次analysis.confirmedFindings[].id；不能使用图谱节点ID、方案key或新生成的ID。无法关联时填空数组。',
        });
    for (const [i, id] of q.evidenceIds.entries())
      if (!evidence.has(id))
        issues.push({
          code: 'UNKNOWN_EVIDENCE_REFERENCE',
          path: `questions[${index}].evidenceIds[${i}]`,
          message:
            '问题只能引用本次analysis.evidence[].evidenceId；不能使用来源ID、段落ID或图谱节点ID。无法关联时填空数组。',
        });
    if (issues.length >= 8) break;
  }
  if (issues.length) throw new LabContractError('待确认问题引用无效。', issues.slice(0, 8));
}
export function validateRoleResult(input: LabStageRequest, raw: unknown): RoleOutput {
  const out = roleOutputSchema.parse(raw);
  const features = new Set(
      input.analysis.confirmedFindings
        .filter((f) => f.status !== 'excluded' && f.basis !== 'excluded')
        .map((f) => f.id),
    ),
    evidence = new Set(input.analysis.evidence.map((e) => e.evidenceId));
  const keys = new Set<string>();
  for (const s of out.solutions) {
    if (input.interactionMode === 'plan' && !s.productPlan)
      throw new LabContractError('规划方案缺少产品范围与取舍。', [
        {
          code: 'MISSING_PRODUCT_PLAN',
          path: 'solutions.productPlan',
          message: 'AI规划模式的方案必须包含目标、优先/暂缓功能、差异、复杂度与能力建议。',
        },
      ]);
    if (keys.has(s.key)) throw new LabContractError('岗位方案key重复。');
    keys.add(s.key);
    const roles = new Set(s.roles.map((r) => r.key));
    if (
      s.productPlan &&
      [...s.productPlan.priorityFeatureIds, ...s.productPlan.deferredFeatureIds].some(
        (id) => !features.has(id),
      )
    )
      throw new LabContractError('产品方案的功能引用不属于当前范围。');
    if (
      s.productPlan?.priorityFeatureIds.some((id) => s.productPlan!.deferredFeatureIds.includes(id))
    )
      throw new LabContractError('同一功能不能同时优先实施与暂缓。');
    if (roles.size !== s.roles.length) throw new LabContractError('角色key重复。');
    if (
      s.relatedFeatureIds.some((id) => !features.has(id)) ||
      s.relatedEvidenceIds.some((id) => !evidence.has(id))
    )
      throw new LabContractError('岗位方案依据不属于当前分析范围。');
    if (new Set(s.requirements.map((r) => r.key)).size !== s.requirements.length)
      throw new LabContractError('岗位要求key重复。');
    for (const r of s.requirements) {
      if (
        !roles.has(r.roleKey) ||
        [...r.relatedFeatureIds, ...r.inferenceIds].some((id) => !features.has(id)) ||
        r.evidenceIds.some((id) => !evidence.has(id))
      )
        throw new LabContractError('岗位要求的角色、功能或证据引用无效。');
      if (!r.relatedFeatureIds.length && !r.inferenceIds.length && !r.evidenceIds.length)
        throw new LabContractError('岗位要求缺少可追溯依据，不能凭空创建。');
    }
  }
  validateQuestionReferences(input, out.questions);
  return out;
}
