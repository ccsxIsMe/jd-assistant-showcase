'use client';
import {
  buildDemoBundle,
  paperboatTextProject,
  completePaperboatResearch,
  type DemoDefinition,
} from './paperboat';
import { SOFTWARE_OBJECTIVE, SOFTWARE_SOURCES, SOFTWARE_RESUME } from './software-content';
import type { DemoIdentity } from './identity';
import type { Exploration } from '../exploration/model';
export const softwareDefinition: DemoDefinition = {
  fixture: 'software-engineer',
  title: '星桥问题追踪系统 · 软件工程师研究',
  objective: SOFTWARE_OBJECTIVE,
  sources: SOFTWARE_SOURCES,
  planPrefix: '软件工程师',
  choice: 'rbac',
  answer:
    '虚构案例预设：首版权限采用管理员修改状态；React/TypeScript和Node.js由本案例资料明确选择，数据库品牌、预算和工期仍未知。',
  workspaceTitle: '软件工程师（Web应用方向）',
  folder: '/demo/software-engineer',
  brief: 'software-brief.docx',
  resumeName: 'software-resume.docx',
  resume: SOFTWARE_RESUME,
  regionLabels: { signup: '新建问题表单', capacity: '问题状态与权限提示', export: 'CSV导出入口' },
};
export const softwareTextProject = (demo: DemoIdentity) =>
  paperboatTextProject(demo, softwareDefinition);
export const completeSoftwareResearch = (p: Exploration, assets: Set<string>) =>
  completePaperboatResearch(p, assets, softwareDefinition);
export const buildSoftwareBundle = (seed: 'inputs' | 'complete') =>
  buildDemoBundle(seed, softwareDefinition);
