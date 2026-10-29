import type { Exploration, Evidence } from '../exploration/model';
// Ordering and request selection only. Original text, locations and sources stay intact.
export function goalRelevance(p: Exploration, e: Evidence) {
  const goal =
      (p.overviewMode === 'manual' ? p.overview.goal : p.initialObjective) || p.overview.goal || '',
    clean = goal.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''),
    text = e.excerpt.toLowerCase();
  const words = new Set<string>(goal.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  for (let i = 0; i < clean.length - 1; i++)
    if (/[\u4e00-\u9fff]{2}/.test(clean.slice(i, i + 2))) words.add(clean.slice(i, i + 2));
  let score = 0;
  for (const word of words) if (text.includes(word)) score++;
  if (e.evidenceType === 'user-description') score += 5;
  if (/不需要|暂不|禁止|不支持|冲突|限制|not supported|must not/i.test(text)) score += 4;
  if (/^(首页|登录|注册|关注|相关推荐|版权|copyright|sign in|sign up|home)$/i.test(text.trim()))
    score -= 10;
  return score;
}
export function selectAnalysisEvidence(p: Exploration, candidates: Evidence[], limit = 120) {
  if (candidates.length <= limit) return candidates;
  const must = new Set([
    ...p.findings.filter((f) => f.status !== 'excluded').flatMap((f) => f.evidenceIds),
    ...p.questions.flatMap((q) => q.evidenceIds),
    ...(p.lab?.edges
      .filter((e) => e.relationType === 'conflicts_with' && e.status !== 'deleted')
      .flatMap((e) => e.evidenceRefs) ?? []),
    ...candidates
      .filter(
        (e) =>
          e.evidenceType === 'user-description' ||
          /不需要|暂不|禁止|不支持|冲突|限制|must not|not supported/i.test(e.excerpt),
      )
      .map((e) => e.evidenceId),
  ]);
  const represented = new Set<string>();
  for (const e of candidates)
    if (e.sourceId && !represented.has(e.sourceId)) {
      represented.add(e.sourceId);
      must.add(e.evidenceId);
    }
  const ranked = [...candidates].sort((a, b) => goalRelevance(p, b) - goalRelevance(p, a));
  const keep = new Set(candidates.filter((e) => must.has(e.evidenceId)).map((e) => e.evidenceId));
  for (const e of ranked) {
    if (keep.size >= limit) break;
    keep.add(e.evidenceId);
  }
  return candidates.filter((e) => keep.has(e.evidenceId));
}
