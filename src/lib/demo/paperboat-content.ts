// Versioned synthetic material. Never represents a real company or candidate.
export const PAPERBOAT_VERSION = 'paperboat@1' as const;
export const PAPERBOAT_OBJECTIVE =
  '我们是纸舟活动工作室，希望做一个轻量活动报名与管理网站：用户能浏览活动、报名，运营能管理名额、查看名单并导出。团队缺少技术经验，不清楚首版范围和需要什么人。';
export const PAPERBOAT_SOURCES = [
  {
    key: 'reference',
    kind: 'url' as const,
    title: '纸舟参考产品 · 本地模拟介绍页',
    text: '这是本地模拟产品，不是真实在线抓取。\n活动浏览：用户查看活动时间、地点和报名说明。\n在线报名：用户填写报名表单并查看提交结果。\n名单导出：运营筛选名单并导出CSV文件。\n扩展能力：参考产品还展示在线支付、积分和实时聊天，这些不是纸舟已确认需求。',
  },
  {
    key: 'idea',
    kind: 'text' as const,
    title: '纸舟用户需求与团队条件',
    text: `${PAPERBOAT_OBJECTIVE}\n现有两名运营人员，没有内部开发团队。预算和交付时间未定；不承诺薪资、福利或固定人数。\n首版希望活动浏览、报名、名额管理、名单查看和导出；支付、积分、聊天先不纳入。\n技术栈未知，需要结合交付方案明确。`,
  },
  {
    key: 'capacity-a',
    kind: 'text' as const,
    title: '纸舟运营说明A · 当前首轮活动',
    text: '针对当前首轮活动，名额满后仍接受候补报名，运营可手动补位。\n希望负责人确认候补规则和重复报名处理方式。',
  },
  {
    key: 'capacity-b',
    kind: 'text' as const,
    title: '纸舟交付说明B · 同一首轮活动',
    text: '针对同一首轮活动，名额满后立即关闭报名，第一轮不做候补名单。\n需要明确实际采用哪一种名额规则，未决前不要写成已确认事实。',
  },
  {
    key: 'old-jd',
    kind: 'text' as const,
    title: '纸舟旧JD模板 · 过度要求待审阅',
    text: '旧模板要求：独立负责大型支付系统、推荐算法、实时聊天、全部运维及移动原生应用。\n这些条件来自旧模板，是否适用需逐项核对，不作为当前岗位既定要求。',
  },
] as const;
export const PAPERBOAT_REQUIREMENTS = [
  {
    key: 'pages',
    title: '活动页面与报名表单',
    text: '完成活动列表、详情与报名表单，处理必填验证和重复提交，并提供验收样例。',
    type: 'must' as const,
    feature: 'signup',
  },
  {
    key: 'capacity',
    title: '名额边界与重复报名控制',
    text: '结合已确认名额规则实现边界校验，说明并发报名、重复请求和异常恢复的处理方式。',
    type: 'must' as const,
    feature: 'capacity',
  },
  {
    key: 'export',
    title: '名单查看与文件导出',
    text: '实现运营名单筛选及CSV导出，明确字段范围和可复验的导出样例。',
    type: 'must' as const,
    feature: 'export',
  },
  {
    key: 'handover',
    title: '部署交付与维护文档',
    text: '提供部署步骤、运行说明与交接文档；具体托管方式需要与团队确认。',
    type: 'trainable' as const,
    feature: 'handover',
  },
  {
    key: 'ownership',
    title: '项目职责与时间说明',
    text: '能说明本人负责的项目范围、时间与交付成果，并配合核对项目记录。',
    type: 'bonus' as const,
    feature: 'signup',
  },
] as const;
export const PAPERBOAT_RESUME_LINES = [
  '姓名：林舟（虚构候选人）',
  '邮箱：fiction@example.invalid',
  '个人简介：参与小型Web项目交付，以下经历均为合成演示材料。',
  '活动站项目：独立完成活动列表、详情及报名表单，含必填验证和重复提交处理。',
  '名额模块：参与名额校验接口联调；并发报名和异常恢复由团队其他成员处理。',
  '运营模块：实现运营名单筛选及CSV导出，记录导出字段与验收样例。',
  '同一活动站项目摘要：项目时间为2024年4月至6月，本人负责页面与导出。',
  '同一活动站项目明细：项目时间为2024年5月至8月，本人参与页面与导出。',
  '补充说明：上面两处时间未校对；是否包含试运行与正式交付需要核实。',
];
export const PAPERBOAT_RESUME = PAPERBOAT_RESUME_LINES.join('\n');
export const PAPERBOAT_REQUIREMENT_KEYS = PAPERBOAT_REQUIREMENTS.map((r) => r.key);
