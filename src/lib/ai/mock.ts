import { generateInput, optimizeInput, recommendInput, type Task } from '../schemas';
export function mockResult(task: Task, input: unknown): unknown {
  if (task === 'recommend') {
    const { title } = recommendInput.parse(input);
    return {
      duties: [
        `负责${title}相关工作的计划与执行`,
        '与相关团队协作，推进任务交付',
        '跟踪工作成果并持续改进流程',
        '整理工作记录与业务文档',
      ],
      skills: [
        '掌握本岗位所需的专业知识与工具',
        '具备沟通协作与问题分析能力',
        '能够制定工作计划并跟踪结果',
        '具备相关业务实践经验',
      ],
    };
  }
  if (task === 'generate') {
    const d = generateInput.parse(input);
    return `# ${d.title}\n\n## 职位概览\n${d.company || '企业与岗位信息：待补充'}\n\n## 岗位职责\n${d.duties.map((s) => `- ${s}`).join('\n')}\n\n## 任职要求\n${d.skills.map((s) => `- ${s}`).join('\n')}\n\n工作经验：${d.experience || '待补充'}\n\n学历要求：${d.education || '待补充'}\n\n## 待补充信息\n薪资、福利及晋升安排待企业确认。\n\n${d.requirements ? `编辑要求（演示模式仅展示，不执行）：${d.requirements}` : ''}`;
  }
  if (task === 'optimize') {
    const d = optimizeInput.parse(input);
    return {
      strengths: ['原文已提供岗位描述，可作为改写基础（演示示例）。'],
      weaknesses: ['需人工核实职责是否具体、要求是否有证据依据（演示示例）。'],
      suggestions: ['按职责、必要条件和待补充信息整理；使用具体行动与成果描述。'],
      optimized: `# 职位描述优化草稿\n\n## 原始岗位信息（保留供编辑）\n${d.jd}\n\n## 编辑建议\n请将每项职责改写为具体行动和预期成果；区分必备与加分条件。\n\n## 待补充信息\n企业未提供的信息保持待补充。${d.requirements ? `\n\n用户编辑要求：${d.requirements}` : ''}`,
    };
  }
  return {
    overview: {
      summary: '演示报告，不提取或推断候选人个人事实。',
      relevantExperience: '需结合简历原文核实。',
      evidence: '固定示例评分，与本次输入无实际对应关系。',
    },
    total: 70,
    scores: [
      { dimension: '技能证据', score: 70, comment: '演示评分；请核实JD要求对应的简历证据。' },
      { dimension: '相关经验', score: 70, comment: '演示评分；请核实相关实践。' },
      { dimension: '项目成果', score: 70, comment: '演示评分；请核实项目贡献与成果。' },
      { dimension: '职责关联', score: 70, comment: '演示评分；请核实实际职责。' },
    ],
    matches: ['示例：将简历中有明确证据的工作内容与JD逐项对照。'],
    gaps: ['示例：部分要求简历未体现，待核实。'],
    verification: ['需人工核实技能深度、本人贡献与项目成果。'],
    suggestions: ['补充与JD相关的事实、行动、成果和可核实证据，不虚构经历。'],
  };
}
