import {
  materialInput,
  tasksOutput,
  sampleMaterial,
  sampleRef,
  type TaskDefinition,
} from './common';
export const extractRequirements: TaskDefinition = {
  name: 'extractRequirements',
  promptVersion: 'extractRequirements@1.1.0',
  inputSchema: materialInput,
  outputSchema: tasksOutput,
  instruction:
    '从本次资料分别整理实际工作任务、完成任务所需能力、旧模板沿用的条件。tasks表示交付工作，requirements表示候选能力或条件。旧模板条件在scope中明确标识“旧模板沿用，待确认”，不得自行升级为必要事实。任务key唯一，要求taskKeys引用本次任务key。所有候选任务和要求至少有一条准确资料引用；没有依据时不创建条目，改为待确认问题。不要复活人已排除的同义内容，不重复现有任务。技术栈未知时保留未知，不假定React/Vue；只有当前职责决策确实依赖该信息时才提问，允许带明确假设继续草稿。程序会将全部新条目设为待确认。',
  exampleInput: sampleMaterial,
  exampleOutput: {
    tasks: [
      {
        key: 'pages',
        title: '订单页面建设',
        text: '完成订单列表和订单详情页面。',
        scope: '项目实际工作',
        category: 'must',
        refs: [sampleRef],
        taskKeys: [],
      },
    ],
    requirements: [],
    questions: [
      {
        title: '这项岗位首版是否承担新增服务开发？',
        detail: '资料只明确页面交付，需要比较职责范围，而非让非技术用户先决定框架。',
        choices: [
          {
            id: 'existing-api',
            label: '界面实现并对接现有服务',
            impact: '新服务开发交由其他责任方确认',
            sourceType: 'ai_suggestion',
          },
          {
            id: 'service-delivery',
            label: '同时承担新增服务交付',
            impact: '需进一步核对接口、数据和协作边界',
            sourceType: 'ai_suggestion',
          },
        ],
        important: true,
        targetIds: [],
        refs: [sampleRef],
      },
    ],
    notice: '候选条目待人工确认。',
  },
};
