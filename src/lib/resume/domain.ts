import type { Workspace } from '../workbench/model';
import { now, uid } from '../workbench/model';
import { digest } from '../lab/graph';
import { demoFixtureKey } from '../demo/identity';
import {
  resumeOutputSchema,
  standardSchema,
  reviewSessionSchema,
  type ResumeOutput,
  type ResumeRequest,
  type ResumeReport,
  type ReviewSession,
  type Standard,
  type Correction,
} from './model';
export const RESUME_NOTICE =
  '仅核对简历写了什么。可定位不代表能力已核实；未找到描述不代表不具备，不作录用、淘汰或候选人排名。';
/** 捕获本次核对所用岗位标准；报告保留该版本，后续岗位编辑不反向改写旧报告。 */
export function standardFromWorkspace(w: Workspace, versionId?: string): Standard {
  const version = versionId ? w.versions.find((v) => v.id === versionId) : undefined;
  if (versionId && !version) throw new Error('所选岗位版本不存在；历史报告保留。');
  const active = (version?.items ?? w.items).filter(
    (i) => i.status !== 'excluded' && i.category !== 'omit',
  );
  const selected = active.some((i) => i.kind === 'requirement')
    ? active.filter((i) => i.kind === 'requirement')
    : active.filter((i) => i.kind === 'task');
  const requirements = selected.slice(0, 80).map((i) => ({
    id: i.id,
    title: i.title,
    text: [i.text, i.scope].filter(Boolean).join('\n') || i.title,
    category: i.category === 'omit' ? ('unknown' as const) : i.category,
    status: i.status === 'excluded' ? ('pending' as const) : i.status,
    sourceRevision: i.revision,
    refs: i.refs.map((r) => ({
      sourceId: r.sourceId,
      sourceRevision: r.sourceRevision,
      excerpt: r.excerpt,
    })),
    ...(i.researchLink
      ? {
          origin: {
            snapshotId: i.researchLink.snapshotId,
            featureIds: i.researchLink.featureIds,
            evidenceIds: i.researchLink.evidenceIds,
          },
        }
      : {}),
  }));
  if (!requirements.length)
    throw new Error('岗位还没有可核对要求，请先在工作台明确任务或要求；也可使用已有JD入口。');
  const jd = active
    .filter((i) => i.kind === 'block')
    .map((i) => `## ${i.title}\n${i.text}`)
    .join('\n\n');
  const signature = digest({ title: w.title, requirements, jd });
  return standardSchema.parse({
    id: `standard:${w.id}:${signature}`,
    workspaceId: w.id,
    title: w.title,
    kind: version ? 'workspace-version' : 'workspace-draft',
    workspaceRevision: w.revision,
    jdVersionId: version?.id ?? null,
    versionNumber: version?.number ?? null,
    jd,
    requirements,
    capturedAt: now(),
    signature,
    limitations: [
      ...(!version || version.kind === 'draft'
        ? ['当前采用岗位草稿，尚未等同于正式发布标准。']
        : []),
      ...(requirements.some((r) => r.status !== 'confirmed')
        ? ['含待确认或需复核要求；模型不会反向确认岗位。']
        : []),
      ...(selected.length > 80 ? ['当前最多核对80条要求，请在工作台收敛范围。'] : []),
    ],
  });
}
export function standardFromJd(jd: string): Standard {
  if (jd.trim().length < 10 || jd.length > 30000) throw new Error('请提供10至30000字的岗位JD。');
  const lines = jd
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && !/^#{1,6}\s/.test(s));
  const values = [...new Set(lines)].slice(0, 40);
  if (!values.length) values.push(jd.trim());
  if (values.some((s) => s.length > 3000))
    throw new Error('单条要求超过3000字，请按实际职责换行后重试；输入仍保留。');
  const requirements = values.map((text) => ({
    id: uid(),
    title: text.replace(/^[-*\d、.\s]+/, '').slice(0, 45),
    text,
    category: 'unknown' as const,
    status: 'pending' as const,
    sourceRevision: 1,
    refs: [],
  }));
  return standardSchema.parse({
    id: uid(),
    workspaceId: null,
    title: '已有JD · 材料核对',
    kind: 'direct-jd',
    workspaceRevision: 1,
    jdVersionId: null,
    versionNumber: null,
    jd,
    requirements,
    capturedAt: now(),
    signature: digest({ jd, requirements }),
    limitations: ['按原文行整理的待核对要求，尚未进行语义提炼；请整体查看并修改，未知分类可保留。'],
  });
}
export function editDirectRequirement(standard: Standard, id: string, text: string) {
  if (standard.workspaceId) throw new Error('岗位标准请回到工作台修改，核对报告不会反向改岗位。');
  if (!text.trim()) throw new Error('要求内容不能为空。');
  const next = structuredClone(standard),
    r = next.requirements.find((r) => r.id === id);
  if (!r) throw new Error('要求不存在');
  r.text = text.trim();
  r.title = text.trim().slice(0, 45);
  r.sourceRevision++;
  next.signature = digest({ jd: next.jd, requirements: next.requirements });
  next.capturedAt = now();
  return standardSchema.parse(next);
}
/**
 * 遮盖常见身份字段并保持字符串长度，供引用定位复用原坐标。
 * 这是有限的文本规则，不保证识别所有个人信息；发送前仍需用户审阅并确认。
 */
export function redactResume(text: string) {
  return text.replace(/[^\r\n]+/g, (line) =>
    /^(\s*)(姓名|性别|年龄|婚育|婚姻|民族|出生|生日|户籍|身份证|照片|电话|手机|邮箱|电子邮件|name|gender|age|marital|ethnicity|phone|email)\s*[:：]/i.test(
      line,
    )
      ? ' '.repeat(line.length)
      : line
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) => ' '.repeat(m.length))
          .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, (m) => ' '.repeat(m.length)),
  );
}
export function resumeParagraphs(text: string) {
  const rows: { id: string; text: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/[^\r\n]+/g)) {
    const content = match[0].trim();
    if (!content) continue;
    const start = match.index + match[0].indexOf(content);
    rows.push({ id: `p${rows.length + 1}`, text: content, start, end: start + content.length });
  }
  return rows;
}
export const materialSignature = (text: string) =>
  digest(
    redactResume(text)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
export function newReviewSession(standard: Standard): ReviewSession {
  return {
    schemaVersion: 1,
    id: uid(),
    workspaceId: standard.workspaceId,
    title: standard.title,
    createdAt: now(),
    updatedAt: now(),
    revision: 1,
    standard,
    mode: 'example',
    material: { id: uid(), revision: 1, text: '', fileName: '', parser: 'pasted' },
    reports: [],
    corrections: [],
  };
}
export function prepareResumeRequest(s: ReviewSession, consent: boolean): ResumeRequest {
  if (!consent) throw new Error('请先审阅材料并主动确认发送范围。');
  const text = redactResume(s.material.text);
  if (text.trim().length < 10) throw new Error('简历职业经历文字不足，请补充至少10字可核对内容。');
  if (
    s.standard.requirements.some((r) =>
      /性别|婚育|婚姻|民族|宗教|照片|年龄[限制要求]|[男女]性优先/.test(r.text),
    )
  )
    throw new Error('标准含与岗位能力无关的个人属性，请回到岗位标准移除后再核对。');
  return {
    sessionId: s.id,
    mode: s.mode,
    standard: s.standard,
    material: { ...s.material, fileName: '已遮盖常见身份字段的简历文本', text },
    consent: true,
    ...(demoFixtureKey(s.demo) ? { fixture: demoFixtureKey(s.demo) } : {}),
  };
}
/** 每条标准均须覆盖；引用必须在本次段落唯一定位，“未找到”不等于不具备能力。 */
export function validateResumeOutput(input: ResumeRequest, raw: unknown): ResumeOutput {
  const data = resumeOutputSchema.parse(raw),
    ids = new Set(input.standard.requirements.map((r) => r.id)),
    seen = new Set<string>(),
    paragraphs = resumeParagraphs(input.material.text);
  if (data.assessments.length !== ids.size) throw new Error('结果必须覆盖本次每一条岗位要求。');
  for (const a of data.assessments) {
    if (!ids.has(a.requirementId) || seen.has(a.requirementId))
      throw new Error('引用了不存在或重复的岗位要求。');
    seen.add(a.requirementId);
    for (const e of a.evidence) {
      const p = paragraphs.find((p) => p.id === e.paragraphId);
      if (
        !p ||
        !p.text.includes(e.quote) ||
        p.text.indexOf(e.quote) !== p.text.lastIndexOf(e.quote)
      )
        throw new Error('简历引用无法唯一定位到本次真实段落。');
    }
    if (a.state === 'not_found' && a.evidence.length)
      throw new Error('未找到描述不能同时附上支持证据。');
    if (a.state !== 'not_found' && !a.evidence.length)
      throw new Error('有描述的判断必须有真实引用。');
    if (a.state === 'inconsistent' && new Set(a.evidence.map((e) => e.paragraphId)).size < 2)
      throw new Error('材料不一致必须提供两处独立依据。');
  }
  return data;
}
export function locateResumeEvidence(
  report: ResumeReport,
  evidence: { paragraphId: string; quote: string },
) {
  const paragraph = resumeParagraphs(report.material.text).find(
    (p) => p.id === evidence.paragraphId,
  );
  if (
    !paragraph ||
    !evidence.quote ||
    !paragraph.text.includes(evidence.quote) ||
    paragraph.text.indexOf(evidence.quote) !== paragraph.text.lastIndexOf(evidence.quote)
  )
    return null;
  const start = paragraph.start + paragraph.text.indexOf(evidence.quote);
  return { start, end: start + evidence.quote.length, paragraphId: paragraph.id };
}
export function effectiveAssessment(s: ReviewSession, report: ResumeReport, requirementId: string) {
  const original = report.data.assessments.find((a) => a.requirementId === requirementId);
  if (!original) throw new Error('报告要求不存在');
  const correction = s.corrections
    .filter(
      (c) =>
        !c.undoneAt &&
        c.requirementId === requirementId &&
        c.standardSignature === report.standard.signature &&
        c.materialSignature === report.materialSignature,
    )
    .at(-1);
  return { ...original, state: correction?.after ?? original.state, correction };
}
export function correctAssessment(
  s: ReviewSession,
  reportId: string,
  requirementId: string,
  state: Correction['after'],
  reason: string,
) {
  const next = structuredClone(s),
    report = next.reports.find((r) => r.id === reportId);
  if (!report) throw new Error('报告不存在');
  if (!reason.trim()) throw new Error('请说明人工修正理由；定位不代表能力核实。');
  const before = effectiveAssessment(s, report, requirementId);
  next.corrections.push({
    id: uid(),
    reportId,
    requirementId,
    standardSignature: report.standard.signature,
    materialSignature: report.materialSignature,
    before: before.state,
    after: state,
    reason: reason.trim(),
    createdAt: now(),
  });
  next.revision++;
  next.updatedAt = now();
  return next;
}
export function undoCorrection(s: ReviewSession, correctionId: string) {
  const n = structuredClone(s),
    c = n.corrections.find((c) => c.id === correctionId);
  if (!c || c.undoneAt) throw new Error('修正不存在或已撤销。');
  const later = n.corrections.some(
    (v) =>
      !v.undoneAt &&
      v.requirementId === c.requirementId &&
      v.standardSignature === c.standardSignature &&
      v.materialSignature === c.materialSignature &&
      n.corrections.indexOf(v) > n.corrections.indexOf(c),
  );
  if (later) throw new Error('该要求已有后续人工修正，请先核对最新决定。');
  c.undoneAt = now();
  n.revision++;
  n.updatedAt = now();
  return n;
}
export function validateReviewSession(raw: unknown): ReviewSession {
  const s = reviewSessionSchema.parse(raw);
  if (s.workspaceId !== s.standard.workspaceId)
    throw new Error('岗位标准与核对记录不属于同一岗位。');
  const ids = new Set<string>();
  for (const r of s.reports) {
    if (ids.has(r.id) || r.standard.workspaceId !== s.workspaceId)
      throw new Error('报告ID重复或引用其他岗位。');
    ids.add(r.id);
    if (materialSignature(r.material.text) !== r.materialSignature)
      throw new Error('报告材料版本校验失败。');
    validateResumeOutput(
      { sessionId: s.id, mode: r.mode, standard: r.standard, material: r.material, consent: true },
      r.data,
    );
  }
  for (const c of s.corrections) {
    const r = s.reports.find((r) => r.id === c.reportId);
    if (
      !r ||
      !r.standard.requirements.some((v) => v.id === c.requirementId) ||
      c.standardSignature !== r.standard.signature ||
      c.materialSignature !== r.materialSignature
    )
      throw new Error('人工修正引用失效，原记录保留。');
  }
  return s;
}
