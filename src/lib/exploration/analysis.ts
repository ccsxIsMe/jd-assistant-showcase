import { z } from 'zod';
import { demoFixtureKey } from '../demo/identity';
import {
  evidenceSchema,
  exploreSourceSchema,
  findingSchema,
  overviewSchema,
  exploreQuestionSchema,
  type Exploration,
  type AnalysisOutput,
} from './model';
import { evidenceValid } from './domain';
import { currentDecisions, reconcileDecisions } from '../decisions/records';
export const analysisRequestSchema = z
  .object({
    fixture: z.enum(['paperboat@1', 'software-engineer@1']).optional(),
    projectId: z.string().min(1).max(120),
    revision: z.number().int().positive(),
    mode: z.enum(['example', 'real']),
    consent: z.literal(true),
    sources: z.array(exploreSourceSchema).min(1).max(40),
    evidence: z.array(evidenceSchema).max(600),
    confirmedFindings: z.array(findingSchema).max(150),
    overview: overviewSchema,
    questions: z.array(exploreQuestionSchema).max(100),
  })
  .strict();
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export function analysisRequestFor(p: Exploration): AnalysisRequest {
  return analysisRequestSchema.parse({
    ...(demoFixtureKey(p.demo) ? { fixture: demoFixtureKey(p.demo) } : {}),
    projectId: p.id,
    revision: p.revision,
    mode: p.mode,
    consent: true,
    sources: p.sources
      .filter((s) => !s.removed && ['ready', 'partial'].includes(s.status))
      .map((s) => ({ ...s, versions: [s.versions.at(-1)!] })),
    evidence: p.evidence.filter((e) => evidenceValid(p, e)),
    confirmedFindings: p.findings.filter(
      (f) => f.status === 'confirmed' || f.status === 'excluded',
    ),
    overview: p.overview,
    questions: currentDecisions(reconcileDecisions(p.questions, p.id)),
  });
}
export function exampleAnalysis(input: AnalysisRequest): AnalysisOutput {
  const evidence = input.evidence.filter((e) => evidenceValid(input, e));
  const primary = evidence.filter((e) => e.evidenceType === 'user-description');
  const summary = primary[0] ?? evidence[0];
  const candidates = evidence.filter((e) => e.excerpt.trim()).slice(0, 12);
  const findings: AnalysisOutput['findings'] = candidates.map((e, index) => {
    const source = input.sources.find((s) => s.id === e.sourceId)!;
    const excluded = source.purpose === 'excluded' || /^(明确不借鉴|不需要|不要)/.test(e.excerpt);
    return {
      key: `feature-${index + 1}`,
      parentKey: null,
      kind: 'feature',
      title:
        e.excerpt.replace(/^(明确希望借鉴|明确不借鉴|参考目的)：/, '').slice(0, 36) ||
        `资料功能${index + 1}`,
      description: e.excerpt,
      behavior: e.excerpt,
      outcome: '验收结果待用户补充',
      priority: 'medium',
      phase: 'mvp',
      basis: excluded
        ? 'excluded'
        : e.evidenceType === 'user-description'
          ? 'explicit'
          : 'observed',
      evidenceIds: [e.evidenceId],
    };
  });
  return {
    overview: {
      goal: summary?.excerpt.slice(0, 1000) ?? '',
      problem: '',
      users: '',
      outcome: '',
      constraints: '',
      evidenceIds: summary ? [summary.evidenceId] : [],
      inferredFields: [],
    },
    findings,
    questions: [
      {
        title: '主要用户、验收标准与技术方案分别由谁确认？',
        detail: '预置演示仅按现有文字建立候选；未确定的技术栈不能作为既定架构或招聘结论。',
        findingKeys: [],
        evidenceIds: [],
      },
    ].filter(
      (q) =>
        !input.questions.some(
          (old) => old.title === q.title && ['answered', 'excluded'].includes(old.status),
        ),
    ),
    notice: '演示数据，非真实AI分析。按已解析文字形成预置候选，未执行图像、视频或网页视觉识别。',
  };
}
