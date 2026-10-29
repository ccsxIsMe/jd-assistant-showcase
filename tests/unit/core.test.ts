import { describe, expect, it } from 'vitest';
import {
  generateInput,
  inputs,
  matchInput,
  matchOutput,
  outputs,
  recommendInput,
  textSchema,
  type Task,
} from '../../src/lib/schemas';
import { readConfig } from '../../src/lib/ai/config';
import { mockResult } from '../../src/lib/ai/mock';
import { exportMarkdown, matchMarkdown, optimizationMarkdown } from '../../src/lib/export';
import { validateExtractedText, validateFile } from '../../src/lib/documents/validation';
const generate = {
  title: '招聘专员',
  duties: ['制定招聘计划'],
  skills: ['面试沟通'],
  company: '',
  experience: '',
  education: '',
  requirements: '',
};
describe('输入与模型边界', () => {
  it('拒绝空白与非法输入', () => {
    expect(recommendInput.safeParse({ title: '  ' }).success).toBe(false);
    expect(textSchema.safeParse('短').success).toBe(false);
    expect(textSchema.safeParse('字'.repeat(30001)).success).toBe(false);
    expect(generateInput.safeParse({ ...generate, duties: [] }).success).toBe(false);
    expect(recommendInput.safeParse({ title: 'HR', apiKey: 'unexpected' }).success).toBe(false);
  });
  it('分析必须主动确认', () => {
    expect(
      matchInput.safeParse({
        jd: '原始岗位信息内容足够十个字',
        resume: '简历项目经历内容足够十个字',
        consent: false,
      }).success,
    ).toBe(false);
  });
  it('所有mock数据与真实模式共用输出Schema', () => {
    const values: Record<Task, unknown> = {
      recommend: { title: '招聘专员' },
      generate,
      optimize: { jd: '招聘专员负责招聘流程与面试安排' },
      match: {
        jd: '招聘专员负责招聘流程与面试安排',
        resume: '具备面试安排与招聘流程实践经历',
        consent: true,
      },
    };
    for (const task of Object.keys(values) as Task[]) {
      const input = inputs[task].parse(values[task]);
      expect(outputs[task].safeParse(mockResult(task, input)).success).toBe(true);
    }
  });
  it('拒绝越界评分、重复维度与不一致总分', () => {
    const data = matchOutput.parse(mockResult('match', {}));
    expect(matchOutput.safeParse({ ...data, total: 101 }).success).toBe(false);
    expect(
      matchOutput.safeParse({ ...data, scores: data.scores.map((s) => ({ ...s, score: -1 })) })
        .success,
    ).toBe(false);
    expect(matchOutput.safeParse({ ...data, total: 69 }).success).toBe(false);
    expect(
      matchOutput.safeParse({
        ...data,
        scores: data.scores.map((s) => ({ ...s, dimension: '技能证据' })),
      }).success,
    ).toBe(false);
  });
  it('真实模式缺少配置明确报错，不回退', () => {
    expect(() => readConfig({ AI_MODE: 'real' })).toThrow('缺少');
    expect(() => readConfig({ AI_MODE: 'real', DEEPSEEK_API_KEY: 'test-only' })).toThrow(
      'DEEPSEEK_MODEL',
    );
    expect(() => readConfig({ AI_MODE: 'unknown' })).toThrow('AI_MODE');
    expect(readConfig({}).mode).toBe('mock');
  });
});
describe('文档与导出', () => {
  it('拒绝不支持类型、超限、空文件与MIME冲突', () => {
    for (const file of [
      { name: 'r.doc', size: 1, type: '' },
      { name: 'r.pdf', size: 11 * 1024 * 1024, type: 'application/pdf' },
      { name: 'r.pdf', size: 0, type: '' },
      { name: 'r.pdf', size: 1, type: 'text/html' },
    ])
      expect(() => validateFile(file)).toThrow();
    expect(validateFile({ name: 'r.DOCX', size: 100, type: '' })).toBe('docx');
  });
  it('拒绝空文本、超限和明显乱码', () => {
    for (const text of ['', '字'.repeat(30001), '�'.repeat(40)])
      expect(() => validateExtractedText(text)).toThrow();
  });
  it('Markdown正确标注模式，各类报告保留说明', () => {
    expect(exportMarkdown('报告', '正文', 'mock')).toContain('演示数据，非真实AI分析');
    expect(exportMarkdown('报告', '正文', 'real')).toContain('真实AI结果，请人工核实');
    expect(exportMarkdown('报告', '正文', 'real')).not.toContain('演示数据');
    const data = matchOutput.parse(mockResult('match', {}));
    expect(matchMarkdown(data)).toContain('不能作为客观录用结论');
    expect(matchMarkdown(data)).toContain('待核实');
    expect(
      optimizationMarkdown(
        outputs.optimize.parse(mockResult('optimize', { jd: '原始职位职责与工作要求十字以上' })),
      ),
    ).toContain('改进建议');
  });
  it('演示JD不补写薪资福利承诺', () => {
    const jd = outputs.generate.parse(mockResult('generate', generate));
    expect(jd).toContain('待企业确认');
    expect(jd).not.toContain('五险一金');
  });
});
