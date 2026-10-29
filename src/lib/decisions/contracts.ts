import { z } from 'zod';
import { decisionFields, decisionResponseSchema, decisionSpecSchema } from './schema';
export const decisionContentSchema = z
  .object({
    title: z.string().min(1).max(300),
    detail: z.string().max(3000),
    choices: decisionFields.choices,
    decisionSpec: decisionFields.decisionSpec,
    recommendation: decisionFields.recommendation,
  })
  .strict();
export const decisionContextSchema = z
  .object({
    id: z.string().min(1).max(160),
    scope: z.enum(['research', 'workbench']),
    objective: z.string().max(3000),
    facts: z
      .array(
        z
          .object({
            id: z.string().max(160),
            text: z.string().max(1500),
            revision: z.string().max(100),
          })
          .strict(),
      )
      .max(16),
    answers: z
      .array(
        z
          .object({
            id: z.string().max(160),
            title: z.string().max(300),
            topic: z.string().max(200),
            decisionSpec: decisionSpecSchema.optional(),
            answer: z.string().max(4000),
            status: z.string().max(30),
            response: decisionResponseSchema.optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const repairDecisionRequestSchema = z
  .object({
    operationId: z.uuid(),
    mode: z.enum(['real', 'example']),
    consent: z.literal(true),
    context: decisionContextSchema,
    question: z
      .object({
        ...decisionFields,
        id: z.string().min(1).max(160),
        title: z.string().min(1).max(300),
        detail: z.string().max(3000),
        answer: z.string().max(4000),
        status: z.string().max(30),
        response: decisionResponseSchema.optional(),
      })
      .strict(),
  })
  .strict();
export const decisionRepairOutputSchema = z
  .object({
    patches: z
      .array(
        z
          .object({
            targetId: z.string().max(160),
            questions: z.array(decisionContentSchema).min(1).max(2),
          })
          .strict(),
      )
      .max(3),
    notice: z.string().max(1000),
  })
  .strict();
export type DecisionContext = z.infer<typeof decisionContextSchema>;
export type RepairDecisionRequest = z.infer<typeof repairDecisionRequestSchema>;
export type DecisionContent = z.infer<typeof decisionContentSchema>;
export type DecisionRepairOutput = z.infer<typeof decisionRepairOutputSchema>;
