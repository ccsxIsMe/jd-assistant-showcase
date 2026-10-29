import {
  materialInput,
  issuesOutput,
  sampleMaterial,
  sampleRef,
  type TaskDefinition,
} from './common';
export const inspectIssues: TaskDefinition = {
  name: 'inspectIssues',
  promptVersion: 'inspectIssues@1.1.0',
  inputSchema: materialInput,
  outputSchema: issuesOutput,
  instruction:
    '检查实际任务、候选要求、原始材料和人工决定，发现来源可能不一致、职责边界含糊、关键事实缺失。使用“建议确认”“可能不一致”，不得把推测当事实。每个问题提供需要人决定的事项、准确引用和已有相关对象ID。answeredQuestions中已resolved/ignored的问题及其同义问题不再重复提出，除非本次来源出现与答案直接矛盾的新事实，并在detail中明确说明变化。已excluded的任务/要求不得未经新证据重新当作必备条件。无问题时questions为空数组。',
  exampleInput: sampleMaterial,
  exampleOutput: {
    questions: [
      {
        title: '新增接口实现是否纳入本岗位？',
        detail: '现有说明只明确了页面交付，职责边界尚缺少确认，请负责人决定接口实现是否纳入。',
        important: true,
        targetIds: ['task-pages'],
        refs: [sampleRef],
        choices: [
          {
            id: 'integrate',
            label: '仅接入已有接口',
            impact: '服务实现需要明确其他协作方',
            sourceType: 'ai_suggestion',
          },
          {
            id: 'implement',
            label: '本岗位负责接口实现',
            impact: '需核对服务开发能力与交付约束',
            sourceType: 'ai_suggestion',
          },
        ],
      },
    ],
    notice: '仅提示需要人确认的事项，不代替负责人决定。',
  },
};
