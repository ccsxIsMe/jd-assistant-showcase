import { newExploration, makeId } from '../exploration/model';
import { createSource, paragraphs, textEvidence } from '../exploration/domain';
import { synchronizeLab } from './graph';
import { buildLabRequest, beginStage, mergeStageResult } from './workflow';
import { mockFeatures, mockLinks, mockRoles } from './mock';
import { labTasks } from '../ai/tasks/lab-stages';
import { z } from 'zod';
export function labTaskExamples() {
  let p = newExploration('固定无敏感内容的任务样例');
  for (const [kind, title, text] of [
    ['url', '演示产品页面', '多人协作：共同编辑。\n文件导出：导出成果。'],
    ['text', '用户补充', '第一阶段先做单人编辑和文件导出，实时同步待确认。'],
    ['text', '旧模板', '首版必须支持多人协作，模板有效性待核实。'],
  ] as const) {
    const s = createSource(kind, title);
    s.status = 'ready';
    s.versions[0].text = text;
    s.versions[0].paragraphs = paragraphs(text, kind === 'url' ? 'extracted' : 'user');
    p.sources.push(s);
    p.evidence.push(...textEvidence(s, s.versions[0]));
  }
  p = synchronizeLab(p);
  p.lab!.ui.researchMode = 'plan';
  return (['derive_features', 'link_evidence', 'propose_roles'] as const).map((stage) => {
    const input = buildLabRequest(p, stage),
      task = labTasks[stage],
      output =
        stage === 'derive_features'
          ? mockFeatures(input)
          : stage === 'link_evidence'
            ? mockLinks(input)
            : mockRoles(input),
      start = beginStage(p, stage, input.inputVersions, [], task.promptVersion);
    p = mergeStageResult(
      start.project,
      start.run.id,
      input,
      { stage, output },
      {
        requestId: makeId(),
        promptVersion: task.promptVersion,
        mode: 'example',
        modelConfigId: 'synthetic-example',
      },
    );
    return {
      name: `lab.${stage}`,
      promptVersion: task.promptVersion,
      system: task.system,
      inputSchema: z.toJSONSchema(task.inputSchema, { target: 'draft-7' }),
      outputSchema: z.toJSONSchema(task.outputSchema, { target: 'draft-7' }),
      input,
      output,
      notice: '演示数据，非真实AI分析。固定无敏感样例，不代表真实研究。',
    };
  });
}
