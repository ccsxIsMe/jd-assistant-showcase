import {
  decisionChoiceSchema,
  decisionSpecSchema,
  type DecisionChoice,
  type DecisionResponse,
  type DecisionSpec,
  type DecisionState,
} from './schema';
export type DecisionQuestion = {
  id?: string;
  title: string;
  detail?: string;
  choices?: DecisionChoice[];
  recommendation?: { choiceId: string; reason: string };
  decisionSpec?: DecisionSpec;
  decision?: DecisionState;
  response?: DecisionResponse;
  answer?: string;
  status?: string;
  findingIds?: string[];
  targetIds?: string[];
};
export const normalizeText = (v: string) =>
  v
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
export function stableDecisionId(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `choice-${(h >>> 0).toString(16)}`;
}
const auxiliary =
  /^(其他(?:请填写|请补充)?|我不确定|不确定|以上(?:都|均)?不适用|暂时跳过|跳过|暂缓|other|unsure|noneoftheabove|skip)$/i;
const vague =
  /^(方案[一二三四1234abcd]|选项[一二三四1234abcd]|根据情况|进一步研究|后续再说|待定|option[abcd1234])$/i;
export function businessChoices(choices: DecisionChoice[] = []) {
  const ids = new Set<string>(),
    labels = new Set<string>();
  return choices.filter((c) => {
    const label = normalizeText(c.label);
    if (
      !label ||
      auxiliary.test(label) ||
      vague.test(label) ||
      !c.impact.trim() ||
      ids.has(c.id) ||
      labels.has(label)
    )
      return false;
    ids.add(c.id);
    labels.add(label);
    return true;
  });
}
export function compoundQuestion(q: DecisionQuestion) {
  if (new Set(q.decisionSpec?.topics?.map(normalizeText)).size > 1) return true;
  const title = q.title;
  if (!/[和与及]|以及|同时/.test(title)) return false;
  const dimensions = [
    /定位|用途|作用/,
    /美术风格|视觉风格|画风/,
    /预算|费用/,
    /交付时间|工期/,
    /技术栈|开发框架/,
    /负责人|决策人/,
  ];
  return dimensions.filter((r) => r.test(title)).length > 1;
}
export function inspectDecision(q: DecisionQuestion) {
  const choices = businessChoices(q.choices),
    issues: string[] = [];
  if (choices.length !== (q.choices?.length ?? 0))
    issues.push('重复、辅助或空泛选项不计入业务选项。');
  if (compoundQuestion(q)) issues.push('本题包含多个决策维度，需要拆分或改为方案比较。');
  const old = q.decision;
  let generation: DecisionState['generation'] =
    choices.length >= 2 ? 'ready' : choices.length === 1 ? 'suggestion' : 'needs_repair';
  if (compoundQuestion(q)) generation = 'needs_repair';
  if (choices.length === 1 && (q.choices?.length ?? 0) > 1) generation = 'needs_repair';
  if (q.recommendation && !choices.some((c) => c.id === q.recommendation!.choiceId)) {
    generation = 'needs_repair';
    issues.push('推荐未指向有效业务选项。');
  }
  if (old?.generation === 'needs_repair' && old.issues.some((i) => /重复|推荐/.test(i)))
    generation = 'needs_repair';
  if (old?.generation === 'known' && q.decisionSpec?.knownAnswer) generation = 'known';
  if (
    q.decisionSpec?.selection === 'text' &&
    q.decisionSpec.explanation.trim() &&
    !compoundQuestion(q)
  )
    generation = 'text';
  if (!choices.length && generation === 'needs_repair')
    issues.push('该问题的可选方案尚未生成完成。');
  if (old?.generation === 'failed' && generation === 'needs_repair') generation = 'failed';
  const answerNeedsReview =
    !!old?.answerNeedsReview ||
    !!(
      q.response?.kind === 'choice' &&
      (q.response.choiceIds.some((id) => !choices.some((c) => c.id === id)) ||
        (q.response.optionsVersion !== undefined &&
          q.response.optionsVersion !== (old?.optionsVersion ?? 1)))
    );
  return {
    choices,
    generation,
    issues,
    answerNeedsReview,
    ready:
      generation === 'ready' ||
      generation === 'suggestion' ||
      generation === 'known' ||
      generation === 'text',
  };
}
export function initializeDecision<T extends DecisionQuestion>(q: T): T {
  const inspected = inspectDecision({ ...q, decision: undefined });
  return {
    ...q,
    choices: inspected.choices,
    decisionSpec: q.decisionSpec ?? {
      topic: q.title.slice(0, 200),
      selection: inspected.generation === 'suggestion' ? 'suggestion' : 'single',
      topics: [q.title.slice(0, 100)],
      explanation: (q.detail || '这个决定用于比较当前方案；可以先保留未知。').slice(0, 1000),
      knownFacts: [],
      unknowns: [],
      requiredNow: false,
      requiredReason: '尚无必须立即处理的依据。',
    },
    decision: {
      generation: inspected.generation,
      version: 1,
      optionsVersion: 1,
      issues: inspected.issues,
      answerNeedsReview: false,
      auxiliary: { custom: true, uncertain: true, none: inspected.choices.length >= 2, skip: true },
    },
  };
}
// Transport aliases are normalized explicitly before schema parsing, never fabricated as facts.
export function normalizeDecisionOutput(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { patches?: unknown }).patches))
    return {
      ...raw,
      patches: (raw as { patches: unknown[] }).patches.map((p) => normalizeDecisionOutput(p)),
    };
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { questions?: unknown }).questions))
    return raw;
  return {
    ...raw,
    questions: (raw as { questions: unknown[] }).questions.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const q = { ...item } as Record<string, unknown>;
      if (!('choices' in q) && 'options' in q) q.choices = q.options;
      delete q.options;
      delete q.decision;
      if (q.decisionSpec !== undefined && !decisionSpecSchema.safeParse(q.decisionSpec).success)
        delete q.decisionSpec;
      const options = Array.isArray(q.choices) ? q.choices : [];
      q.choices = options.slice(0, 5).flatMap((option) => {
        const c = typeof option === 'string' ? { label: option } : option;
        if (!c || typeof c !== 'object') return [];
        const v = c as Record<string, unknown>,
          label = v.label ?? v.title ?? v.text;
        if (typeof label !== 'string') return [];
        const parsed = decisionChoiceSchema.safeParse({
          id: typeof v.id === 'string' ? v.id : stableDecisionId(label),
          label,
          impact:
            typeof (v.impact ?? v.effect ?? v.description) === 'string'
              ? (v.impact ?? v.effect ?? v.description)
              : '',
          ...(typeof v.description === 'string' ? { description: v.description } : {}),
          ...(v.sourceType ? { sourceType: v.sourceType } : {}),
          ...(v.reference ? { reference: v.reference } : {}),
        });
        return parsed.success ? [parsed.data] : [];
      });
      if (q.recommendation === null) delete q.recommendation;
      return q;
    }),
  };
}
export function decisionFingerprint(q: DecisionQuestion) {
  return JSON.stringify([
    q.id,
    q.title,
    q.detail,
    q.choices,
    q.decisionSpec,
    q.response,
    q.answer,
    q.status,
    q.decision?.version ?? 1,
    q.decision?.optionsVersion ?? 1,
  ]);
}
export function sameDecisionTopic(a: DecisionQuestion & { topic?: string }, b: DecisionQuestion) {
  if (a.id && a.id === b.id) return true;
  const phase = (q: DecisionQuestion) =>
    q.decisionSpec?.scope?.phase ??
    (/后续|下一阶段|第二阶段/.test(q.title)
      ? 'next'
      : /首版|第一阶段|MVP/i.test(q.title)
        ? 'mvp'
        : 'unspecified');
  if (phase(a) !== phase(b)) return false;
  if (
    a.decisionSpec?.scope &&
    b.decisionSpec?.scope &&
    JSON.stringify(a.decisionSpec.scope) !== JSON.stringify(b.decisionSpec.scope)
  )
    return false;
  const left = a.findingIds ?? a.targetIds,
    right = b.findingIds ?? b.targetIds;
  if (
    left?.length &&
    right?.length &&
    JSON.stringify([...left].sort()) !== JSON.stringify([...right].sort())
  )
    return false;
  return !!(
    (a.id && a.id === b.id) ||
    normalizeText(a.title) === normalizeText(b.title) ||
    ((a.topic || a.decisionSpec?.topic) &&
      b.decisionSpec?.topic &&
      normalizeText(a.topic || a.decisionSpec!.topic) === normalizeText(b.decisionSpec.topic))
  );
}
export function stampDecisionResponse(
  q: DecisionQuestion,
  value: DecisionResponse,
): DecisionResponse {
  const state = inspectDecision(q),
    version = q.decision?.version ?? 1,
    optionsVersion = q.decision?.optionsVersion ?? 1;
  if (value.questionVersion !== undefined && value.questionVersion !== version)
    throw new Error('问题版本已改变，请核对后再保存。');
  if (value.optionsVersion !== undefined && value.optionsVersion !== optionsVersion)
    throw new Error('选项版本已改变，请核对后再保存。');
  if (
    value.kind === 'choice' &&
    (!state.ready ||
      !value.choiceIds.length ||
      value.choiceIds.some((id) => !state.choices.some((c) => c.id === id)))
  )
    throw new Error('请选择本题有效业务选项。');
  if (
    value.kind === 'choice' &&
    q.decisionSpec?.selection !== 'multiple' &&
    value.choiceIds.length !== 1
  )
    throw new Error('本题只允许选择一个业务方向。');
  if (value.kind === 'none' && state.choices.length < 2)
    throw new Error('本题尚无可比较业务选项，不能记录为全部不适用。');
  return { ...value, questionVersion: version, optionsVersion, optionSnapshot: state.choices };
}
export function applyDecisionVersion<T extends DecisionQuestion>(
  q: T,
  replacement: DecisionQuestion,
): T {
  const checked = initializeDecision(replacement),
    prior = q.decision,
    version = (prior?.version ?? 1) + 1,
    optionsVersion = (prior?.optionsVersion ?? 1) + 1;
  const history = [
    ...(prior?.history ?? []),
    {
      title: q.title,
      version: prior?.version ?? 1,
      optionsVersion: prior?.optionsVersion ?? 1,
      choices: q.choices ?? [],
      ...(q.response ? { response: q.response } : {}),
    },
  ].slice(-12);
  return {
    ...q,
    title: replacement.title,
    detail: replacement.detail ?? q.detail,
    choices: checked.choices,
    decisionSpec: checked.decisionSpec,
    recommendation: replacement.recommendation,
    decision: {
      ...prior,
      ...checked.decision!,
      version,
      optionsVersion,
      history,
      answerNeedsReview: !!q.response,
      promptVersion: replacement.decision?.promptVersion ?? 'decision-options@1.1.0',
    },
  };
}
export function decisionSettled(q: DecisionQuestion) {
  return (
    !inspectDecision(q).answerNeedsReview &&
    (['answered', 'resolved', 'deferred', 'excluded', 'ignored'].includes(q.status ?? '') ||
      !!q.response ||
      q.decision?.generation === 'known')
  );
}
export function questionSnapshot(q: DecisionQuestion & { id: string }) {
  return {
    id: q.id,
    title: q.title,
    detail: q.detail ?? '',
    choices: q.choices,
    decisionSpec: q.decisionSpec,
    decision: q.decision,
    recommendation: q.recommendation,
    response: q.response,
    answer: q.answer ?? '',
    status: q.status ?? 'open',
  };
}
export function replaceDecisionQuestion<T extends DecisionQuestion & { id: string }>(
  original: T,
  replacements: DecisionQuestion[],
): T[] {
  if (!replacements.length || replacements.some((q) => !inspectDecision(q).ready))
    throw new Error('该问题的可选方案尚未生成完成。');
  const first = applyDecisionVersion(original, replacements[0]);
  if (replacements[0].decision?.generation === 'known') first.decision!.generation = 'known';
  return [
    first,
    ...replacements.slice(1).map(
      (q) =>
        ({
          ...original,
          ...q,
          id: crypto.randomUUID(),
          answer: '',
          response: undefined,
          status: 'open',
          decision: { ...initializeDecision(q).decision!, parentQuestionId: original.id },
        }) as T,
    ),
  ];
}
