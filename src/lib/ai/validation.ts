import { z } from 'zod';
export const validationIssueSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z_]+$/)
      .max(80),
    path: z.string().max(180),
    message: z.string().max(500),
  })
  .strict();
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
const fields = new Set(
  'blocks tasks groups changes before after targetId operation reason impactIds refs taskIds requirementIds sourceId sourceRevision excerpt text scope category overview goal problem users outcome constraints evidenceIds inferredFields findings key parentKey kind title description behavior basis priority phase rationale uncertainty questions detail findingKeys findingIds relations sourceNodeId targetNodeId relationType evidenceRefs leftEvidenceIds rightEvidenceIds solutions roles requirements relatedFeatureIds relatedEvidenceIds inferenceIds roleKey headcount requirementType assumptions advantages disadvantages openQuestions notice strengths weaknesses suggestions optimized overview total scores matches gaps informationToVerify resumeSuggestions'.split(
    ' ',
  ),
);
export function schemaIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 8).map((issue) => ({
    code: `SCHEMA_${issue.code.toUpperCase()}`,
    path:
      issue.path
        .slice(0, 8)
        .map((part) =>
          typeof part === 'number'
            ? `[${part}]`
            : typeof part === 'string' && fields.has(part)
              ? part
              : '字段',
        )
        .join('.')
        .replace(/\.\[/g, '[')
        .slice(0, 180) || 'output',
    message:
      issue.code === 'invalid_type'
        ? '字段类型不符或缺少必填字段；请对照JSON结构。'
        : issue.code === 'invalid_value'
          ? '字段值不在允许的枚举中。'
          : issue.code === 'unrecognized_keys'
            ? '存在任务结构之外的字段。'
            : issue.code === 'too_big'
              ? '字段或条目数量超过限制。'
              : issue.code === 'too_small'
                ? '字段为空或条目数量不足。'
                : '字段未通过任务结构校验。',
  }));
}
