import { z } from 'zod';
import {
  materialInput,
  draftOutput,
  sampleMaterial,
  sampleRef,
  type TaskDefinition,
} from './common';
export const generateJdDraft: TaskDefinition = {
  name: 'generateJdDraft',
  promptVersion: 'generateJdDraft@1.2.0',
  inputSchema: materialInput.extend({ generationMode: z.literal('initial') }).strict(),
  outputSchema: draftOutput,
  instruction:
    '只根据status=confirmed且未排除的任务与要求生成分块JD。保持must必要条件、bonus加分项、train可培养条件的区分，不混为必备。未确认的薪资、福利、地点、工作方式、公司规模等一律省略；缺失且关键时提出问题。每个内容块保留实际taskIds、requirementIds及准确引用。不得引用不存在或未确认对象。不要加入内部讨论、来源ID或系统日志到正文。已有草稿必须通过proposeLocalChanges逐段审阅，不能调用此任务覆盖人工编辑。',
  exampleInput: { ...sampleMaterial, generationMode: 'initial' },
  exampleOutput: {
    blocks: [
      {
        title: '主要职责',
        text: '- 完成订单列表和订单详情页面。',
        taskIds: ['task-pages'],
        requirementIds: [],
        refs: [sampleRef],
      },
    ],
    questions: [],
    notice: '这是待人审核的JD草稿。',
  },
};
