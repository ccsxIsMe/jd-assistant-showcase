import { it, expect, describe } from 'vitest';
import { paperboatTextProject, completePaperboatResearch } from '../../src/lib/demo/paperboat';
import { makeId, explorationSchema } from '../../src/lib/exploration/model';
import { deleteRelation } from '../../src/lib/lab/operations';
import { undoResearch } from '../../src/lib/exploration/journal';
import { assertLab } from '../../src/lib/lab/graph';
import { materialFromSnapshot } from '../../src/lib/exploration/material';
import { importRequirementMaterial } from '../../src/lib/exploration/workbench-import';
import { newWorkspace, now } from '../../src/lib/workbench/model';
import { PAPERBOAT_RESUME } from '../../src/lib/demo/paperboat-content';
import {
  correctAssessment,
  effectiveAssessment,
  materialSignature,
  newReviewSession,
  prepareResumeRequest,
  redactResume,
  resumeParagraphs,
  standardFromJd,
  standardFromWorkspace,
  undoCorrection,
  validateResumeOutput,
  validateReviewSession,
} from '../../src/lib/resume/domain';
import { mockResumeReview } from '../../src/lib/resume/mock';
import { reportSchema, resumeRequestSchema } from '../../src/lib/resume/model';
import { resumeReportMarkdown } from '../../src/lib/resume/export';
import { remapDemoObjectIds } from '../../src/lib/demo/instances';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
function paperboat() {
  return completePaperboatResearch(
    paperboatTextProject({
      fixture: 'paperboat',
      version: 1,
      instanceId: makeId(),
      kind: 'demo',
      seed: 'complete',
    }),
    new Set(),
  );
}
function review() {
  const p = paperboat(),
    m = materialFromSnapshot(p.snapshots[0]);
  const w = importRequirementMaterial(
    newWorkspace('纸舟岗位', true),
    m,
    m.features.filter((f) => f.status === 'confirmed').map((f) => f.id),
    true,
  );
  const s = newReviewSession(standardFromWorkspace(w));
  s.demo = p.demo;
  s.material.text = PAPERBOAT_RESUME;
  const input = prepareResumeRequest(s, true);
  const data = validateResumeOutput(input, mockResumeReview(input));
  s.reports.push(
    reportSchema.parse({
      id: makeId(),
      requestId: makeId(),
      createdAt: now(),
      mode: 'example',
      standard: input.standard,
      material: input.material,
      materialSignature: materialSignature(input.material.text),
      data,
      promptVersion: 'resumeEvidenceReview@1.0.0',
      modelConfigId: 'paperboat-preset-v1',
    }),
  );
  return { s, input, w, p };
}
describe('纸舟案例与岗位贯通', () => {
  it('实际展示资源与版本清单哈希一致，标注均在真实图像范围', async () => {
    const folder = new URL('../../public/demo/paperboat/', import.meta.url),
      m = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
    expect(m.files).toHaveLength(5);
    for (const f of m.files) {
      const bytes = await readFile(new URL(f.name, folder));
      expect(bytes.length).toBe(f.size);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
    }
    for (const r of m.image.regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
      expect(r.x + r.width).toBeLessThanOrEqual(1);
      expect(r.y + r.height).toBeLessThanOrEqual(1);
    }
  });
  it('Schema保存恢复不会向历史局部补丁注入默认方案字段，关系撤销保留已选方案', () => {
    let p = explorationSchema.parse(paperboat());
    const before = structuredClone(p.lab!.researchGuide),
      edge = p.lab!.edges.find((e) => e.relationType === 'conflicts_with')!;
    p = explorationSchema.parse(deleteRelation(p, edge.id));
    const op = p.operations!.at(-1)!;
    expect(op.after.lab?.researchGuide).toBeUndefined();
    p = undoResearch(p, op.id);
    expect(p.lab!.researchGuide).toEqual(before);
    expect(p.lab!.edges.find((e) => e.id === edge.id)!.status).not.toBe('deleted');
  });
  it('预置阶段通过正式模型、引用和关系校验，两个历史版本不可变', () => {
    const p = paperboat();
    assertLab(p);
    expect(p.lab!.solutions).toHaveLength(3);
    expect(p.lab!.solutions.some((s) => s.hiringNeed === 'not-needed')).toBe(true);
    expect(p.snapshots).toHaveLength(2);
    const before = JSON.stringify(p.snapshots);
    p.findings[0].description = '人工新编辑';
    expect(JSON.stringify(p.snapshots)).toBe(before);
    expect(p.lab!.edges.some((e) => e.relationType === 'conflicts_with')).toBe(true);
  });
  it('完整对象复制重绑定ID、来源版本和图谱而不改旧对象', () => {
    const p = paperboat(),
      copy = remapDemoObjectIds(p);
    expect(copy.id).not.toBe(p.id);
    expect(copy.sources[0].id).not.toBe(p.sources[0].id);
    assertLab(copy);
    expect(p.sources[0].versions[0].text).toBe(copy.sources[0].versions[0].text);
  });
  it('岗位导入保持待确认、五条要求及可追溯快照', () => {
    const { w, p } = review();
    const reqs = w.items.filter((i) => i.kind === 'requirement');
    expect(reqs).toHaveLength(5);
    expect(reqs.every((i) => i.status === 'pending')).toBe(true);
    expect(reqs.every((i) => i.researchLink?.snapshotId === p.snapshots[0].snapshotId)).toBe(true);
  });
});
describe('简历材料判断与人工流程', () => {
  it('空输入、过长输入、未授权输入与缺失结构拒绝', () => {
    expect(() => standardFromJd('')).toThrow();
    expect(() => standardFromJd('x'.repeat(30001))).toThrow();
    const { s, input } = review();
    expect(() => prepareResumeRequest(s, false)).toThrow();
    expect(resumeRequestSchema.safeParse({ ...input, consent: false }).success).toBe(false);
    expect(() => validateResumeOutput(input, {})).toThrow();
  });
  it('覆盖四种状态、实际定位片段，不产生评分与录用结论', () => {
    const { s, input } = review();
    const r = s.reports[0];
    expect(new Set(r.data.assessments.map((a) => a.state)).size).toBe(4);
    for (const a of r.data.assessments)
      for (const e of a.evidence)
        expect(
          resumeParagraphs(input.material.text).find((p) => p.id === e.paragraphId)!.text,
        ).toContain(e.quote);
    expect('score' in r.data).toBe(false);
    expect(validateReviewSession(s)).toEqual(s);
  });
  it('无效要求ID、虚构原文、单方冲突和重复要求拒绝', () => {
    const { input, s } = review();
    const original = s.reports[0].data;
    for (const mutate of [
      (d: typeof original) => {
        d.assessments[0].requirementId = 'missing';
      },
      (d: typeof original) => {
        d.assessments[0].evidence[0].quote = '虚构原文';
      },
      (d: typeof original) => {
        const a = d.assessments.find((a) => a.state === 'inconsistent')!;
        a.evidence = a.evidence.slice(0, 1);
      },
      (d: typeof original) => {
        d.assessments[1].requirementId = d.assessments[0].requirementId;
      },
    ]) {
      const d = structuredClone(original);
      mutate(d);
      expect(() => validateResumeOutput(input, d)).toThrow();
    }
  });
  it('人工修正随重分析保留，可撤销且原始报告不被改写', () => {
    const { s } = review(),
      r = s.reports[0],
      id = r.standard.requirements[0].id;
    const before = JSON.stringify(r);
    let n = correctAssessment(s, r.id, id, 'insufficient', '需要提供验收材料');
    n.reports.push({ ...structuredClone(r), id: makeId() });
    expect(effectiveAssessment(n, n.reports[1], id).state).toBe('insufficient');
    n = undoCorrection(n, n.corrections[0].id);
    expect(effectiveAssessment(n, r, id).state).toBe('explicit');
    expect(JSON.stringify(n.reports[0])).toBe(before);
  });
  it('岗位后续修改不改变旧报告与标准，导出标明模式及上游', () => {
    const { s, w } = review(),
      r = s.reports[0],
      before = JSON.stringify(r);
    const changed = w.items.find((i) => i.kind === 'requirement')!;
    changed.text += '后续编辑';
    changed.revision++;
    expect(standardFromWorkspace(w).signature).not.toBe(r.standard.signature);
    expect(JSON.stringify(r)).toBe(before);
    const md = resumeReportMarkdown(s, r);
    expect(md).toContain('示例项目｜虚构材料｜预置分析结果');
    expect(md).toContain('上游快照');
    expect(md).toContain('未找到描述');
  });
  it('无关身份字段变化不改变确定性职业材料判断', () => {
    const { s } = review();
    const a = prepareResumeRequest(s, true);
    const n = structuredClone(s);
    n.material.text =
      n.material.text.replace(/姓名：[^\n]+/, '姓名：另一个虚构人物') +
      '\n年龄：22\n性别：女\n电话：13800000000';
    const b = prepareResumeRequest(n, true);
    expect(materialSignature(a.material.text)).toBe(materialSignature(b.material.text));
    expect(mockResumeReview(a)).toEqual(mockResumeReview(b));
    expect(redactResume(n.material.text)).not.toContain('13800000000');
  });
  it('修改后的示例材料不套用预置答案，已有数据保留', () => {
    const { s } = review();
    s.material.text += '\n新增独立部署经验，请单独核实。';
    const before = JSON.stringify(s);
    expect(() => mockResumeReview(prepareResumeRequest(s, true))).toThrow('超出预置');
    expect(JSON.stringify(s)).toBe(before);
  });
});
