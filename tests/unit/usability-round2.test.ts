import { it, expect, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { softwareTextProject, completeSoftwareResearch } from '../../src/lib/demo/software';
import { makeId, newExploration } from '../../src/lib/exploration/model';
import { assertLab } from '../../src/lib/lab/graph';
import { buildLabRequest, beginStage, mergeStageResult } from '../../src/lib/lab/workflow';
import { mockFeatures } from '../../src/lib/lab/mock';
import {
  validateAnalysis,
  createSource,
  paragraphs,
  textEvidence,
} from '../../src/lib/exploration/domain';
import { validateRoleResult } from '../../src/lib/lab/ai-contract';
import { configuredClientMode } from '../../src/lib/ai/client-mode';
import { materialFromSnapshot } from '../../src/lib/exploration/material';
import { importRequirementMaterial } from '../../src/lib/exploration/workbench-import';
import { newWorkspace } from '../../src/lib/workbench/model';
import {
  standardFromWorkspace,
  newReviewSession,
  prepareResumeRequest,
  validateResumeOutput,
} from '../../src/lib/resume/domain';
import { mockResumeReview } from '../../src/lib/resume/mock';
import { SOFTWARE_RESUME } from '../../src/lib/demo/software-content';
import { characterDesignRoles } from '../../src/lib/lab/domain-planning';
afterEach(() => vi.unstubAllGlobals());
it('软件工程师实际资料哈希与清单一致，页面没有沿用活动报名文案', async () => {
  const folder = 'public/demo/software-engineer/';
  const manifest = JSON.parse(await readFile(`${folder}manifest.json`, 'utf8')) as {
    fixture: string;
    files: { name: string; sha256: string; size: number }[];
  };
  expect(manifest.fixture).toBe('software-engineer');
  expect(manifest.files).toHaveLength(5);
  for (const f of manifest.files) {
    const bytes = await readFile(`${folder}${f.name}`);
    expect(bytes.length).toBe(f.size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
  }
  const html = await readFile(`${folder}reference.html`, 'utf8');
  expect(html).toContain('React / TypeScript');
  expect(html).toContain('问题追踪');
  expect(html).not.toContain('报名');
});
it('软件工程师案例复用正式阶段、快照和要求，旧命名空间未覆盖', () => {
  const p = completeSoftwareResearch(
    softwareTextProject({
      fixture: 'software-engineer',
      version: 1,
      instanceId: makeId(),
      kind: 'demo',
      seed: 'complete',
    }),
    new Set(),
  );
  assertLab(p);
  expect(p.snapshots).toHaveLength(2);
  expect(p.lab!.solutions).toHaveLength(3);
  expect(p.lab!.requirements.some((r) => r.title.includes('React'))).toBe(true);
  expect(p.lab!.requirements.some((r) => r.title.includes('Node.js'))).toBe(true);
  expect(p.lab!.requirements.some((r) => r.title.includes('SQL'))).toBe(true);
  const m = materialFromSnapshot(p.snapshots[0]),
    w = importRequirementMaterial(
      newWorkspace('软件工程师'),
      m,
      m.features.filter((f) => f.status === 'confirmed').map((f) => f.id),
      true,
    ),
    s = newReviewSession(standardFromWorkspace(w));
  s.demo = p.demo;
  s.material.text = SOFTWARE_RESUME;
  const input = prepareResumeRequest(s, true),
    output = validateResumeOutput(input, mockResumeReview(input));
  expect(new Set(output.assessments.map((a) => a.state)).size).toBe(4);
  expect(w.items.filter((i) => i.kind === 'requirement').every((i) => i.status === 'pending')).toBe(
    true,
  );
});
it('游戏角色需求有2D/3D、基本功、数字绘画与辅助工具具体候选，不输出软件开发套话', () => {
  let p = newExploration('角色设计需求');
  const s = createSource('text', '用户想法');
  s.status = 'ready';
  s.versions[0].text = '我想做一个游戏角色设计，还没有确定是2D原画还是3D角色。';
  s.versions[0].paragraphs = paragraphs(s.versions[0].text, 'user');
  p.sources.push(s);
  p.evidence.push(...textEvidence(s, s.versions[0]));
  const input = buildLabRequest(p, 'derive_features'),
    output = mockFeatures(input);
  validateAnalysis(input.analysis, output);
  const start = beginStage(p, 'derive_features', input.inputVersions, [], 'test');
  p = mergeStageResult(
    start.project,
    start.run.id,
    input,
    { stage: 'derive_features', output },
    { requestId: makeId(), promptVersion: 'test', mode: 'example', modelConfigId: 'local-rule' },
  );
  const req = buildLabRequest(p, 'propose_roles'),
    roles = characterDesignRoles(req);
  validateRoleResult(req, roles);
  const text = JSON.stringify(roles);
  expect(text).toContain('2D角色原画');
  expect(text).toContain('绘画与造型基本功');
  expect(text).toContain('Photoshop');
  expect(text).toContain('3D辅助');
  expect(text).not.toContain('前后端');
  expect(
    roles.solutions.every((s) => s.requirements.every((r) => r.uncertainty.includes('用户确认'))),
  ).toBe(true);
});
it.each([
  ['real', 'real'],
  ['mock', 'example'],
] as const)('新岗位只读取公开%s配置，不发起模型请求', async (server, expected) => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mode: server }) });
  vi.stubGlobal('fetch', fetcher);
  expect(await configuredClientMode()).toBe(expected);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/status');
});
