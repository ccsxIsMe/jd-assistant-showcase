import type { DecisionContent, DecisionContext } from '../../src/lib/decisions/contracts';
const option = (id: string, label: string, impact: string) => ({
  id,
  label,
  impact,
  sourceType: 'ai_suggestion' as const,
});
const question = (
  title: string,
  topic: string,
  choices: ReturnType<typeof option>[],
): DecisionContent => ({
  title,
  detail: '固定无敏感内容的测试方向，不是真实模型输出。',
  choices,
  decisionSpec: {
    topic,
    selection: 'single',
    topics: [topic],
    explanation: '这个决定会改变当前方案的交付范围。',
    requiredNow: false,
    requiredReason: '可以带假设继续',
  },
});
export const decisionCases = [
  {
    name: '游戏角色',
    original: '角色在游戏中的定位和美术风格是什么？',
    facts: '希望设计一个游戏角色，角色作用与视觉方向尚未确定。',
    questions: [
      question('这个角色主要承担什么作用？', '角色作用', [
        option('playable', '主要可操作角色', '围绕玩家操作与角色辨识设计'),
        option('opponent', '关卡中的对手角色', '围绕对抗场景与行为辨识设计'),
        option('story', '剧情交互角色', '围绕叙事、对话和交互表达设计'),
      ]),
      question('你更希望采用哪种视觉方向？', '视觉方向', [
        option('realistic', '偏写实比例与材质', '强调可信结构与材质表现'),
        option('stylized', '偏夸张轮廓与色彩', '强调形象辨识与风格表达'),
        option('drawn', '偏平涂线稿的画面表达', '强调线条、色块和画面一致性'),
      ]),
    ],
  },
  {
    name: '活动报名',
    original: '报名名额满后如何处理？',
    facts: '计划做一个有名额上限的活动报名网站，尚未决定满额后的处理方式。',
    questions: [
      question('报名名额满后如何处理？', '满额处理', [
        option('close', '停止接受新报名', '名额满后关闭当前场次报名'),
        option('waitlist', '转入候补名单', '需要候补顺序与通知规则'),
        option('next-event', '登记后续场次通知意向', '仅收集后续通知意向，不承诺本场名额'),
      ]),
    ],
  },
  {
    name: '岗位范围',
    original: '这项岗位主要承担哪段交付？',
    facts: '岗位要交付业务系统，首版的界面、接口与数据职责边界尚未决定。',
    questions: [
      question('这项岗位主要承担哪段交付？', '首版岗位范围', [
        option('ui', '页面与交互实现', '服务能力由其他协作方提供'),
        option('service', '服务接口与数据处理', '页面能力由其他协作方提供'),
        option('end-to-end', '覆盖两端并分阶段交付', '需要分别核对界面和服务的能力与验收边界'),
      ]),
    ],
  },
];
export function caseContext(index: number): DecisionContext {
  const c = decisionCases[index];
  return {
    id: `case-${index}`,
    scope: index === 2 ? 'workbench' : 'research',
    objective: c.facts,
    facts: [{ id: 'source-1', text: c.facts, revision: '1' }],
    answers: [],
  };
}
