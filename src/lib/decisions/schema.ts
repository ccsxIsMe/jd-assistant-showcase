import { z } from 'zod';
export const decisionChoiceSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
    impact: z.string().max(1000),
    description: z.string().max(500).optional(),
    sourceType: z.enum(['user_material', 'existing_answer', 'ai_suggestion']).optional(),
    reference: z
      .object({ id: z.string().max(160), quote: z.string().max(1000) })
      .strict()
      .optional(),
  })
  .strict();
export const decisionSpecSchema = z
  .object({
    scope: z
      .object({
        dimension: z.string().min(1).max(100),
        phase: z.enum(['mvp', 'next', 'later', 'unspecified']),
        perspective: z.enum(['our_product', 'reference_product', 'role']),
        objectIds: z.array(z.string().min(1).max(160)).max(40),
      })
      .strict()
      .optional(),
    topic: z.string().max(200),
    selection: z.enum(['single', 'multiple', 'suggestion', 'text']),
    explanation: z.string().max(1000),
    topics: z.array(z.string().max(100)).max(3).optional(),
    knownFacts: z.array(z.string().max(500)).max(8).optional(),
    unknowns: z.array(z.string().max(500)).max(8).optional(),
    requiredNow: z.boolean(),
    requiredReason: z.string().max(500),
    knownAnswer: z
      .object({
        text: z.string().max(2000),
        referenceId: z.string().max(160),
        quote: z.string().max(1000),
      })
      .strict()
      .optional(),
  })
  .strict();
export const decisionResponseSchema = z
  .object({
    kind: z.enum(['choice', 'custom', 'uncertain', 'skipped', 'none']),
    choiceIds: z.array(z.string().min(1).max(80)).max(5),
    text: z.string().max(4000),
    questionVersion: z.number().int().positive().optional(),
    optionsVersion: z.number().int().positive().optional(),
    optionSnapshot: z.array(decisionChoiceSchema).max(5).optional(),
  })
  .strict();
export const decisionStateSchema = z
  .object({
    generation: z.enum(['ready', 'suggestion', 'known', 'text', 'needs_repair', 'failed', 'stale']),
    version: z.number().int().positive(),
    optionsVersion: z.number().int().positive(),
    issues: z.array(z.string().max(500)).max(15),
    auxiliary: z
      .object({ custom: z.boolean(), uncertain: z.boolean(), none: z.boolean(), skip: z.boolean() })
      .strict(),
    answerNeedsReview: z.boolean(),
    promptVersion: z.string().max(100).optional(),
    parentQuestionId: z.string().max(160).optional(),
    canonicalId: z.string().max(160).optional(),
    aliasIds: z.array(z.string().max(160)).max(100).optional(),
    identity: z.string().max(3000).optional(),
    updatedAt: z.string().max(100).optional(),
    inheritedFrom: z
      .object({ projectId: z.string(), snapshotId: z.string(), questionId: z.string() })
      .optional(),
    mergedAnswers: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            answer: z.string().max(4000),
            status: z.string(),
            response: decisionResponseSchema.optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    provisional: z
      .object({ label: z.string().max(200), reason: z.string().max(1000) })
      .strict()
      .optional(),
    history: z
      .array(
        z
          .object({
            title: z.string().max(300),
            version: z.number().int().positive(),
            optionsVersion: z.number().int().positive(),
            choices: z.array(decisionChoiceSchema).max(5),
            response: decisionResponseSchema.optional(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();
export const decisionFields = {
  choices: z.array(decisionChoiceSchema).max(5).optional(),
  decisionSpec: decisionSpecSchema.optional(),
  decision: decisionStateSchema.optional(),
  recommendation: z
    .object({ choiceId: z.string().max(80), reason: z.string().max(1000) })
    .strict()
    .optional(),
};
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;
export type DecisionChoice = z.infer<typeof decisionChoiceSchema>;
export type DecisionSpec = z.infer<typeof decisionSpecSchema>;
export type DecisionState = z.infer<typeof decisionStateSchema>;
