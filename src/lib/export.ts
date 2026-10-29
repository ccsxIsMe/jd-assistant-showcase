import type { MatchReport, Mode, Optimization } from './schemas';
export const modeLabel = (mode: Mode) =>
  mode === 'mock' ? '演示数据，非真实AI分析' : '真实AI结果，请人工核实';
export function exportMarkdown(title: string, body: string, mode: Mode) {
  return `# ${title}\n\n> ${modeLabel(mode)}\n\n${body}\n`;
}
function section(title: string, items: string[]) {
  return `## ${title}\n\n${items.map((v) => `- ${v}`).join('\n')}\n\n`;
}
export function optimizationMarkdown(d: Optimization) {
  return (
    section('原文优点', d.strengths) +
    section('不足', d.weaknesses) +
    section('改进建议', d.suggestions)
  );
}
export const MATCH_NOTICE =
  '评分仅为辅助分析，不能作为客观录用结论。不根据性别、年龄等无关属性评分；简历未体现的能力需进一步核实，不自动决定录用或淘汰。';
export function matchMarkdown(d: MatchReport) {
  return (
    `${MATCH_NOTICE}\n\n综合评分：${d.total}/100（四项等权平均）\n\n## 基础信息概览\n\n${d.overview.summary}\n\n${d.overview.relevantExperience}\n\n${d.overview.evidence}\n\n` +
    section(
      '分项评分',
      d.scores.map((s) => `${s.dimension}：${s.score}/100；${s.comment}`),
    ) +
    section('核心匹配点', d.matches) +
    section('关键差异点', d.gaps) +
    section('待核实信息', d.verification) +
    section('简历优化建议', d.suggestions)
  );
}
