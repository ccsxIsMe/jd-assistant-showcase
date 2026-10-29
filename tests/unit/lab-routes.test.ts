import { it, expect, vi, afterEach } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/ai/adapter', () => ({ callDeepSeekJSON: vi.fn() }));
import { callDeepSeekJSON } from '../../src/lib/ai/adapter';
import { POST } from '../../src/app/api/lab/[stage]/route';
import { POST as imagePOST } from '../../src/app/api/lab/image-evidence/route';
import { syntheticLab } from '../fixtures/lab';
import { buildLabRequest } from '../../src/lib/lab/workflow';
import { ModelError } from '../../src/lib/ai/errors';
import { labTaskExamples } from '../../src/lib/lab/examples';
import { labTasks } from '../../src/lib/ai/tasks/lab-stages';
import { mockLinks, mockRoles } from '../../src/lib/lab/mock';
import { validateLinkResult, validateRoleResult } from '../../src/lib/lab/ai-contract';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(callDeepSeekJSON).mockReset();
});
it('三个分阶段任务的完整样例同时满足输入和输出Schema', () => {
  for (const example of labTaskExamples()) {
    const stage = example.input.stage;
    expect(labTasks[stage].inputSchema.safeParse(example.input).success).toBe(true);
    expect(labTasks[stage].outputSchema.safeParse(example.output).success).toBe(true);
    expect(example.promptVersion).toContain('@');
  }
});
function request(path: string, body: unknown) {
  return new Request(`http://127.0.0.1:3002/api/lab/${path}`, {
    method: 'POST',
    headers: { host: '127.0.0.1:3002', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('实际分阶段接口返回通过Schema的业务数据与程序绑定信封，示例不调用真实模型', async () => {
  const input = buildLabRequest(syntheticLab(20), 'link_evidence');
  const response = await POST(request(input.stage, input), {
    params: Promise.resolve({ stage: input.stage }),
  });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    stage: 'link_evidence',
    mode: 'example',
    projectId: input.projectId,
    baseRevision: input.revision,
    inputVersions: input.inputVersions,
  });
  expect(body.requestId).toBeTruthy();
  expect(callDeepSeekJSON).not.toHaveBeenCalled();
});
it('格式错误与非法任务拒绝，实际路由的安全日志没有资料正文', async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const p = syntheticLab(20),
    input = buildLabRequest(p, 'link_evidence');
  input.analysis.sources[0].versions[0].text = 'private-canary-should-never-log';
  const response = await POST(request('propose_roles', input), {
    params: Promise.resolve({ stage: 'propose_roles' }),
  });
  expect(response.status).toBe(422);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-canary');
  expect(callDeepSeekJSON).not.toHaveBeenCalled();
});
it('真实格式失败只受控修复一次，不回退到示例成功', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const input = buildLabRequest(syntheticLab(20), 'link_evidence');
  input.mode = 'real';
  input.analysis.mode = 'real';
  vi.mocked(callDeepSeekJSON).mockResolvedValue({
    relations: [{ sourceNodeId: 'nonexistent' }],
    questions: [],
    notice: '',
  });
  const response = await POST(request('link_evidence', input), {
    params: Promise.resolve({ stage: 'link_evidence' }),
  });
  expect(response.status).toBe(422);
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
  const body = await response.json();
  expect(body.code).toBe('INVALID_FORMAT');
});
it('认证错误不修复、不回退，真实请求调用错误直接返回', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const input = buildLabRequest(syntheticLab(20), 'link_evidence');
  input.mode = 'real';
  input.analysis.mode = 'real';
  vi.mocked(callDeepSeekJSON).mockRejectedValue(new ModelError('AUTHENTICATION', '认证失败', 401));
  const response = await POST(request('link_evidence', input), {
    params: Promise.resolve({ stage: 'link_evidence' }),
  });
  expect(response.status).toBe(401);
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(1);
});
it('关联问题误用节点ID时明确反馈字段，修复只重试一次并传入实际ID对照', async () => {
  const input = buildLabRequest(syntheticLab(20), 'link_evidence');
  input.mode = 'real';
  input.analysis.mode = 'real';
  const valid = mockLinks(input);
  valid.questions = [
    {
      title: '范围尚需核对',
      detail: '',
      choices: [
        { id: 'small', label: '先验证当前核心范围', impact: '先交付已有功能' },
        { id: 'extended', label: '纳入附加范围再交付', impact: '需先核对新增需求' },
      ],
      findingIds: [input.analysis.confirmedFindings[0].id],
      evidenceIds: [],
    },
  ];
  const invalid = structuredClone(valid);
  invalid.questions[0].findingIds = [`finding:${valid.questions[0].findingIds[0]}`];
  vi.mocked(callDeepSeekJSON).mockResolvedValueOnce(invalid).mockResolvedValueOnce(valid);
  const result = await POST(request('link_evidence', input), {
    params: Promise.resolve({ stage: 'link_evidence' }),
  });
  expect(result.status).toBe(200);
  expect(callDeepSeekJSON).toHaveBeenCalledTimes(2);
  const repair = vi.mocked(callDeepSeekJSON).mock.calls[1][0].input as {
    findingCatalog: unknown[];
    repair: { issues: unknown[] };
  };
  expect(repair.findingCatalog).toContainEqual(
    expect.objectContaining({
      findingId: input.analysis.confirmedFindings[0].id,
      nodeId: `finding:${input.analysis.confirmedFindings[0].id}`,
    }),
  );
  expect(repair.repair.issues).toContainEqual(
    expect.objectContaining({
      code: 'UNKNOWN_FINDING_REFERENCE',
      path: 'questions[0].findingIds[0]',
    }),
  );
  expect((await result.json()).output.questions[0].findingIds).toEqual(
    valid.questions[0].findingIds,
  );
});
it('无效问题的两种引用均拒绝，反馈及日志不含模型正文或未知ID，原数据保留', async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const input = buildLabRequest(syntheticLab(20), 'link_evidence');
  input.mode = 'real';
  input.analysis.mode = 'real';
  const before = JSON.stringify(input);
  vi.mocked(callDeepSeekJSON).mockResolvedValue({
    relations: [],
    questions: [
      {
        title: 'private-model-text',
        detail: '',
        findingIds: ['private-invalid-finding'],
        evidenceIds: ['private-invalid-proof'],
      },
    ],
    notice: '',
  });
  const result = await POST(request('link_evidence', input), {
    params: Promise.resolve({ stage: 'link_evidence' }),
  });
  const body = await result.json();
  expect(result.status).toBe(422);
  expect(body).toMatchObject({
    code: 'INVALID_REFERENCE',
    attempts: 2,
    validationIssues: [
      { code: 'UNKNOWN_FINDING_REFERENCE', path: 'questions[0].findingIds[0]' },
      { code: 'UNKNOWN_EVIDENCE_REFERENCE', path: 'questions[0].evidenceIds[0]' },
    ],
  });
  expect(JSON.stringify([body, log.mock.calls])).not.toContain('private-');
  expect(JSON.stringify(input)).toBe(before);
});
it('岗位方案的问题也验证引用，合法空引用可以保留未知问题', () => {
  const input = buildLabRequest(syntheticLab(20), 'propose_roles'),
    output = mockRoles(input);
  output.questions = [
    { title: '预算未明确', detail: '需人工回答', findingIds: [], evidenceIds: [] },
  ];
  expect(validateRoleResult(input, output).questions).toHaveLength(1);
  output.questions[0].evidenceIds = ['unknown-proof'];
  expect(() => validateRoleResult(input, output)).toThrow('问题引用无效');
  const linkInput = { ...input, stage: 'link_evidence' as const },
    link = mockLinks(linkInput);
  link.questions = [
    {
      title: '未知范围',
      detail: '',
      findingIds: ['finding:' + input.analysis.confirmedFindings[0].id],
      evidenceIds: [],
    },
  ];
  expect(() => validateLinkResult(linkInput, link)).toThrow('问题引用无效');
});
it('图像接口校验实际PNG头与尺寸，示例标识明确且不伪造识别结果', async () => {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(320, 16);
  bytes.writeUInt32BE(180, 20);
  const input = {
    projectId: 'test-project',
    sourceId: 'test-source',
    sourceRevision: 1,
    mode: 'example',
    consent: true,
    png: bytes.toString('base64'),
    width: 320,
    height: 180,
  };
  const response = await imagePOST(request('image-evidence', input));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.output.regions).toEqual([]);
  expect(body.output.limitations.join()).toContain('演示数据，非真实AI分析');
  expect(callDeepSeekJSON).not.toHaveBeenCalled();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect((await imagePOST(request('image-evidence', { ...input, width: 321 }))).status).toBe(422);
  expect(
    (
      await imagePOST(
        request('image-evidence', { ...input, png: Buffer.from('<svg/>').toString('base64') }),
      )
    ).status,
  ).toBe(422);
});
