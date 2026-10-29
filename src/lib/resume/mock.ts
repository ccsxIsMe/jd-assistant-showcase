import { PAPERBOAT_REQUIREMENTS, PAPERBOAT_RESUME } from '../demo/paperboat-content';
import { SOFTWARE_REQUIREMENTS, SOFTWARE_RESUME } from '../demo/software-content';
import { materialSignature, resumeParagraphs } from './domain';
import type { ResumeRequest, ResumeOutput } from './model';
export function mockResumeReview(input: ResumeRequest): ResumeOutput {
  const paragraphs = resumeParagraphs(input.material.text);
  if (input.fixture === 'software-engineer@1') {
    if (
      materialSignature(input.material.text) !== materialSignature(SOFTWARE_RESUME) ||
      input.standard.requirements.some(
        (r) => !SOFTWARE_REQUIREMENTS.some((s) => s.title === r.title && r.text.startsWith(s.text)),
      )
    )
      throw new Error(
        '软件工程师的材料或标准超出预置范围，已有编辑保留；请手工核对或主动使用真实AI。',
      );
    const evidence = (quote: string) => {
      const p = paragraphs.find((p) => p.text.includes(quote));
      if (!p) throw new Error('示例原文缺失，未生成引用。');
      return { paragraphId: p.id, quote };
    };
    return {
      summary:
        '示例项目｜虚构材料｜预置分析结果。按软件工程师的具体要求核对陈述，不给分数或录用结论。',
      assessments: input.standard.requirements.map((r) => {
        if (r.title === SOFTWARE_REQUIREMENTS[0].title)
          return {
            requirementId: r.id,
            state: 'explicit' as const,
            explanation:
              '有React/TypeScript界面和验证样例的明确陈述，真实性与独立交付能力仍需核实。',
            evidence: [evidence('使用React与TypeScript独立完成问题列表、表单校验与状态反馈')],
            questions: ['能否展示一次表单异常反馈的验收样例？'],
          };
        if (r.title === SOFTWARE_REQUIREMENTS[1].title)
          return {
            requirementId: r.id,
            state: 'insufficient' as const,
            explanation: '有接口联调描述，尚不足以说明本人负责权限校验和重复请求处理。',
            evidence: [evidence('参与Node.js接口联调；身份权限和重复请求处理由其他同事完成')],
            questions: ['本人实现过哪些接口和错误分支？'],
          };
        if (r.title === SOFTWARE_REQUIREMENTS[2].title)
          return {
            requirementId: r.id,
            state: 'explicit' as const,
            explanation: '明确写到数据关系、SQL查询和导出，仍需代码或项目材料核实。',
            evidence: [evidence('设计问题与操作记录的数据关系，使用SQL完成条件查询与CSV导出')],
            questions: [],
          };
        if (r.title === SOFTWARE_REQUIREMENTS[4].title)
          return {
            requirementId: r.id,
            state: 'inconsistent' as const,
            explanation: '同一项目有两个时间范围，可能对应不同阶段，需双方材料核对。',
            evidence: [evidence('项目时间为2024年4月至6月'), evidence('项目时间为2024年5月至8月')],
            questions: ['两处时间分别对应哪个阶段？能否提供Git与交付记录？'],
          };
        return {
          requirementId: r.id,
          state: 'not_found' as const,
          explanation: '简历未体现，待核实；不代表候选人不会测试或CI。',
          evidence: [],
          questions: ['是否有自动化测试或CI检查的实际样例？'],
        };
      }),
    };
  }
  if (input.fixture) {
    if (materialSignature(input.material.text) !== materialSignature(PAPERBOAT_RESUME))
      throw new Error(
        '示例材料已超出预置覆盖范围。修改保留，请手工核对或主动使用真实AI，不会套用旧结论。',
      );
    if (
      input.standard.requirements.some(
        (r) =>
          !PAPERBOAT_REQUIREMENTS.some((t) => t.title === r.title && r.text.startsWith(t.text)),
      )
    )
      throw new Error('岗位标准已改变，预置核对不适用；请保留人工编辑并切换真实分析或手工核对。');
    const evidence = (part: string) => {
      const p = paragraphs.find((p) => p.text.includes(part));
      if (!p) throw new Error('演示引用缺失');
      return { paragraphId: p.id, quote: part };
    };
    return {
      summary:
        '示例项目｜虚构材料｜预置分析结果。逐条查看有描述、不足、未知和材料不一致，不给出录用结论。',
      assessments: input.standard.requirements.map((r) => {
        if (r.title === '活动页面与报名表单')
          return {
            requirementId: r.id,
            state: 'explicit',
            explanation: '简历明确写到页面、报名和验证；真实性及完整验收仍需核实。',
            evidence: [evidence('独立完成活动列表、详情及报名表单，含必填验证和重复提交处理。')],
            questions: ['能否展示一次真实的报名验收样例？'],
          };
        if (r.title === '名额边界与重复报名控制')
          return {
            requirementId: r.id,
            state: 'insufficient',
            explanation: '有接口联调描述，但不足以支持本人完整负责并发和恢复；不据此断言不具备。',
            evidence: [evidence('参与名额校验接口联调；并发报名和异常恢复由团队其他成员处理。')],
            questions: ['本人处理过哪些名额边界，如何验证重复请求？'],
          };
        if (r.title === '名单查看与文件导出')
          return {
            requirementId: r.id,
            state: 'explicit',
            explanation: '有名单、CSV字段和验收记录的明确陈述，仍需材料核实。',
            evidence: [evidence('实现运营名单筛选及CSV导出，记录导出字段与验收样例。')],
            questions: [],
          };
        if (r.title === '项目职责与时间说明')
          return {
            requirementId: r.id,
            state: 'inconsistent',
            explanation: '同一项目两处时间范围不同；可能对应不同阶段，需先核实双方记录。',
            evidence: [evidence('项目时间为2024年4月至6月'), evidence('项目时间为2024年5月至8月')],
            questions: ['这两个时间分别对应试运行、正式交付还是录入差错？'],
          };
        return {
          requirementId: r.id,
          state: 'not_found',
          explanation: '简历未体现，待核实；不能据此判断候选人不会。',
          evidence: [],
          questions: ['是否有部署步骤或交接文档可以补充？'],
        };
      }),
    };
  }
  return {
    summary: '演示数据，非真实AI分析。通用示例只检查完整要求是否逐字出现，不进行语义或能力判断。',
    assessments: input.standard.requirements.map((r) => {
      const p = paragraphs.find((p) => p.text.includes(r.text));
      return {
        requirementId: r.id,
        state: p ? 'explicit' : 'not_found',
        explanation: p
          ? '找到逐字陈述，不能由字符串匹配证明语义正确或真实能力。'
          : '示例模式未开展本次语义分析；简历未体现，待核实。',
        evidence: p ? [{ paragraphId: p.id, quote: r.text }] : [],
        questions: ['请结合实际项目材料人工核实。'],
      };
    }),
  };
}
