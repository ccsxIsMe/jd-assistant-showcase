'use client';
import { newExploration, makeId, timestamp, type Exploration } from '../exploration/model';
import { createSource, paragraphs, textEvidence, createSnapshot } from '../exploration/domain';
import { synchronizeLab, assertLab } from '../lab/graph';
import {
  addAnnotation,
  choosePlanningSolution,
  confirmPlanningPackage,
  respondToResearchQuestion,
} from '../lab/operations';
import { beginStage, buildLabRequest, mergeStageResult, recordLocalStages } from '../lab/workflow';
import { mockFeatures, mockLinks, mockRoles } from '../lab/mock';
import { labPromptVersions } from '../lab/ai-contract';
import { conflictSignature, planningSignature } from '../lab/planning';
import { materialFromSnapshot } from '../exploration/material';
import { importRequirementMaterial } from '../exploration/workbench-import';
import { ingestFile } from '../exploration/files';
import { newWorkspace } from '../workbench/model';
import { setItemState, saveVersion, respondToWorkbenchQuestion } from '../workbench/domain';
import { exampleResponse } from '../workbench/example';
import { ingestAI } from '../workbench/ai-apply';
import type { AIRequest } from '../workbench/ai-contract';
import {
  newReviewSession,
  standardFromWorkspace,
  prepareResumeRequest,
  validateResumeOutput,
  materialSignature,
} from '../resume/domain';
import { mockResumeReview } from '../resume/mock';
import { reportSchema } from '../resume/model';
import { PAPERBOAT_SOURCES, PAPERBOAT_OBJECTIVE, PAPERBOAT_RESUME } from './paperboat-content';
import type { DemoIdentity } from './identity';
export type DemoDefinition = {
  fixture: DemoIdentity['fixture'];
  title: string;
  objective: string;
  sources: readonly { key: string; kind: 'url' | 'text'; title: string; text: string }[];
  planPrefix: string;
  choice: string;
  answer: string;
  workspaceTitle: string;
  folder: string;
  brief: string;
  resumeName: string;
  resume: string;
  regionLabels: Record<string, string>;
};
export const paperboatDefinition: DemoDefinition = {
  fixture: 'paperboat',
  title: '纸舟活动工作室 · 轻量报名网站',
  objective: PAPERBOAT_OBJECTIVE,
  sources: PAPERBOAT_SOURCES,
  planPrefix: '轻量定制Web',
  choice: 'close',
  answer: '虚构案例预设：首轮满额关闭；技术、预算与维护方式尚未确定，不写成既定承诺。',
  workspaceTitle: '纸舟活动报名Web交付工程师（候选）',
  folder: '/demo/paperboat',
  brief: 'paperboat-brief.docx',
  resumeName: 'paperboat-resume.docx',
  resume: PAPERBOAT_RESUME,
  regionLabels: { signup: '报名入口', export: 'CSV导出入口', capacity: '名额状态区域' },
};
export function paperboatTextProject(
  demo: DemoIdentity,
  definition: DemoDefinition = paperboatDefinition,
) {
  let p = newExploration(definition.title);
  p.demo = demo;
  p.initialObjective = definition.objective;
  for (const data of [
    ...definition.sources,
    { key: 'goal', kind: 'text' as const, title: '产品构想', text: definition.objective },
  ]) {
    const source = createSource(data.kind, data.title);
    source.status = 'ready';
    source.versions[0].text = data.text;
    source.versions[0].paragraphs = paragraphs(
      data.text,
      data.kind === 'url' ? 'extracted' : 'user',
    );
    if (data.kind === 'url')
      source.versions[0].description = `内部可信演示资源 ${definition.folder}/reference.html，非真实外网抓取。`;
    p.sources.push(source);
    p.evidence.push(...textEvidence(source, source.versions[0]));
  }
  p = synchronizeLab(p);
  p.lab!.ui.researchMode = 'plan';
  p.lab!.ui.guided = true;
  p.activity = [
    {
      id: makeId(),
      at: timestamp(),
      text: `实例化${definition.fixture}@1虚构展示输入；时间为本机载入时间，未调用真实模型。`,
    },
  ];
  return p;
}
export function completePaperboatResearch(
  raw: Exploration,
  assets: Set<string>,
  definition: DemoDefinition = paperboatDefinition,
) {
  let p = recordLocalStages(raw);
  for (const stage of ['derive_features', 'link_evidence', 'propose_roles'] as const) {
    if (stage === 'propose_roles') {
      const q = p.questions.find((q) => q.choices?.some((c) => c.id === definition.choice));
      if (q)
        p = respondToResearchQuestion(p, q.id, {
          kind: 'choice',
          choiceIds: [definition.choice],
          text: '',
        });
    }
    const input = buildLabRequest(p, stage),
      start = beginStage(p, stage, input.inputVersions, [], labPromptVersions[stage]);
    start.project.lab!.runs.at(-1)!.planningSignature = planningSignature(p, stage);
    const output =
      stage === 'derive_features'
        ? mockFeatures(input)
        : stage === 'link_evidence'
          ? mockLinks(input)
          : mockRoles(input);
    p = mergeStageResult(
      start.project,
      start.run.id,
      input,
      { stage, output },
      {
        requestId: makeId(),
        promptVersion: labPromptVersions[stage],
        mode: 'example',
        modelConfigId: `${definition.fixture}-preset-v1`,
      },
    );
  }
  p.snapshots.unshift(createSnapshot(p, 'draft', assets));
  const plan = p.lab!.solutions.find((s) => s.title.startsWith(definition.planPrefix))!;
  p = choosePlanningSolution(p, [plan.id], 'selected');
  p = confirmPlanningPackage(
    p,
    p.lab!.requirements.filter((r) => r.solutionId === plan.id).map((r) => r.id),
    conflictSignature(p),
  );
  p.activity.unshift({
    id: makeId(),
    at: timestamp(),
    text: `载入预设演示选择：${definition.planPrefix}及逐条要求；不是当前用户审批或真实AI输出。`,
  });
  p.snapshots.unshift(createSnapshot(p, 'draft', assets));
  p.lab!.ui.planningScreen = 'results';
  p.lab!.ui.researchStep = 'roles';
  assertLab(p);
  return p;
}
export async function buildDemoBundle(
  seed: 'inputs' | 'complete',
  definition: DemoDefinition = paperboatDefinition,
) {
  const demo: DemoIdentity = {
    fixture: definition.fixture,
    version: 1,
    instanceId: makeId(),
    kind: 'demo',
    seed,
  };
  let initial = paperboatTextProject(demo, definition);
  const manifestRes = await fetch(`${definition.folder}/manifest.json`);
  if (!manifestRes.ok) throw new Error('演示资料清单不可用，请运行prepare:demo。');
  const manifest = (await manifestRes.json()) as {
    image: {
      width: number;
      height: number;
      regions: { key: string; x: number; y: number; width: number; height: number }[];
    };
  };
  const assetIds = new Set<string>();
  for (const [name, type] of [
    [definition.brief, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['interface.png', 'image/png'],
  ] as const) {
    const res = await fetch(`${definition.folder}/${name}`);
    if (!res.ok) throw new Error('演示源文件缺失，未显示初始化成功。');
    const file = new File([await res.blob()], name, { type }),
      result = await ingestFile(initial.id, file, new AbortController().signal);
    if (result.source.status === 'error')
      throw new Error(`演示文件解析失败：${result.source.error}`);
    result.source.title = name.endsWith('.png')
      ? `${definition.title} · 界面示意 · 程序绘制`
      : `${definition.title} · 项目资料 · 实际DOCX解析`;
    initial.sources.push(result.source);
    initial.evidence.push(...result.evidence);
    if (result.version.assetId) assetIds.add(result.version.assetId);
    initial = synchronizeLab(initial);
    if (name.endsWith('.png'))
      for (const region of manifest.image.regions)
        initial = addAnnotation(initial, {
          sourceId: result.source.id,
          sourceRevision: 1,
          shapeType: 'rectangle',
          normalizedGeometry: {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          },
          label: `演示待确认：${definition.regionLabels[region.key] ?? region.key}`,
          status: 'pending',
          createdBy: 'example',
          assetId: result.version.assetId,
          originalWidth: manifest.image.width,
          originalHeight: manifest.image.height,
        });
  }
  const complete = completePaperboatResearch(initial, assetIds, definition),
    snapshot = complete.snapshots[0],
    material = materialFromSnapshot(snapshot);
  let workspace = importRequirementMaterial(
    newWorkspace(definition.workspaceTitle, true),
    material,
    material.features.filter((f) => f.status === 'confirmed').map((f) => f.id),
    true,
  );
  workspace.demo = demo;
  if (seed === 'complete') {
    for (const q of workspace.questions)
      workspace = respondToWorkbenchQuestion(workspace, q.id, {
        kind: 'custom',
        choiceIds: [],
        text: definition.answer,
      });
    for (const item of workspace.items) workspace = setItemState(workspace, item.id, 'confirmed');
    const req: AIRequest = {
      action: 'draft',
      mode: 'example',
      context: {
        id: workspace.id,
        revision: workspace.revision,
        title: workspace.title,
        sources: workspace.sources,
        items: workspace.items,
        questions: workspace.questions,
        demo,
      },
      targetId: null,
      intent: '',
    };
    workspace = ingestAI(workspace, workspace, req, exampleResponse(req));
    for (const item of workspace.items.filter((i) => i.kind === 'block'))
      workspace = setItemState(workspace, item.id, 'confirmed');
    workspace = saveVersion(workspace, 'draft');
    workspace.ui.view = 'jd';
    workspace.activity.unshift({
      id: makeId(),
      at: timestamp(),
      text: '载入虚构展示完成版：预设确认与JD草稿，不代表真实用户审批。',
    });
  }
  const review = { ...newReviewSession(standardFromWorkspace(workspace)), demo };
  review.material.text = definition.resume;
  review.material.parser = 'demo';
  review.material.fileName = `${definition.resumeName}（虚构材料）`;
  if (seed === 'complete') {
    const input = prepareResumeRequest(review, true),
      data = validateResumeOutput(input, mockResumeReview(input));
    review.reports.push(
      reportSchema.parse({
        id: makeId(),
        requestId: makeId(),
        createdAt: timestamp(),
        mode: 'example',
        standard: input.standard,
        material: input.material,
        materialSignature: materialSignature(input.material.text),
        data,
        promptVersion: 'resumeEvidenceReview@1.0.0',
        modelConfigId: `${definition.fixture}-preset-v1`,
      }),
    );
  }
  const project =
    seed === 'complete'
      ? complete
      : { ...initial, snapshots: complete.snapshots, baseSnapshotId: snapshot.snapshotId };
  return { project, workspace, review, demo };
}
export const buildPaperboatBundle = (seed: 'inputs' | 'complete') =>
  buildDemoBundle(seed, paperboatDefinition);
