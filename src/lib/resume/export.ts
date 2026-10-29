import { effectiveAssessment, RESUME_NOTICE } from './domain';
import { materialStateNames, type ReviewSession, type ResumeReport } from './model';
export function resumeReportMarkdown(session: ReviewSession, report: ResumeReport) {
  const mode =
    report.mode === 'example'
      ? session.demo
        ? '示例项目｜虚构材料｜预置分析结果；演示数据，非真实AI分析'
        : '演示数据，非真实AI分析；材料由用户提供，尚未开展本次真实分析'
      : '真实AI候选判断，仍需人工核实';
  return (
    `# 简历证据核对报告\n\n> ${mode}\n\n${RESUME_NOTICE}\n\n岗位：${report.standard.title}\n\n标准：${report.standard.versionNumber ? `V${report.standard.versionNumber}` : '草稿'} · ${report.standard.signature}\n材料版本：${report.material.revision}\n生成时间：${report.createdAt}\n\n${report.data.summary}\n\n` +
    report.standard.requirements
      .map((r) => {
        const a = effectiveAssessment(session, report, r.id);
        return (
          `## ${r.title}\n\n要求ID：${r.id} · 来源版本：${r.sourceRevision}\n\n${r.text}\n\n材料状态：${materialStateNames[a.state]}\n\n${a.explanation}\n\n` +
          a.evidence
            .map((e) => `- ${e.paragraphId}：“${e.quote}”（仅位置可定位，能力待核实）`)
            .join('\n') +
          (a.correction ? `\n\n人工修正：${a.correction.reason}` : '') +
          (a.questions.length ? `\n\n待核实：${a.questions.join('；')}` : '') +
          (r.origin
            ? `\n\n上游快照：${r.origin.snapshotId}；功能：${r.origin.featureIds.join('、')}；证据：${r.origin.evidenceIds.join('、')}`
            : '') +
          '\n\n'
        );
      })
      .join('')
  );
}
