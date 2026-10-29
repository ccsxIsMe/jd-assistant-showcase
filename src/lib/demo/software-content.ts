export const SOFTWARE_OBJECTIVE =
  '我们要招聘一位软件工程师，为小团队开发问题追踪系统：能创建问题、更新状态、按条件搜索并导出列表。希望明确工作任务和能实际交付的工程能力。';
export const SOFTWARE_SOURCES = [
  {
    key: 'reference',
    kind: 'url' as const,
    title: '问题追踪参考产品 · 本地模拟介绍页',
    text: '这是本地模拟产品，不是真实在线抓取。\n问题看板：查看和筛选问题，记录状态变化。\n协作记录：为问题补充说明并查看操作记录。\n导出列表：运营可导出CSV文件。\n参考产品还有复杂审批、支付和AI插件，不代表本项目要实现。',
  },
  {
    key: 'idea',
    kind: 'text' as const,
    title: '软件工程师任务与已选技术',
    text: `${SOFTWARE_OBJECTIVE}\n本次演示资料明确选择React和TypeScript实现Web页面，Node.js与TypeScript提供HTTP接口。\n首版需要问题表单、状态变更、搜索与CSV导出；需要存储问题与操作记录，关系数据库品牌尚未确定。\n现有产品与设计人员可以参与验收，软件工程师需说明接口校验、数据模型和错误处理。\n预算、薪资、年限和上线日期没有确认，不写成承诺。`,
  },
  {
    key: 'capacity-a',
    kind: 'text' as const,
    title: '权限说明A · 当前首版',
    text: '针对当前首版，只有管理员能够修改问题状态，普通成员只能补充说明。\n权限规则必须有接口校验和验收用例。',
  },
  {
    key: 'capacity-b',
    kind: 'text' as const,
    title: '验收说明B · 同一首版',
    text: '针对同一首版，所有已登录成员都能修改问题状态，不区分管理员。\n需要负责人确认实际采用的权限规则，未决前不能当成事实。',
  },
  {
    key: 'old-jd',
    kind: 'text' as const,
    title: '旧软件岗位模板 · 过度要求待审阅',
    text: '旧模板要求：一人精通所有前后端框架、算法推荐、全部运维、原生移动端和大型分布式架构。\n这些是沿用模板，不是当前问题追踪系统的必要事实；应逐项核对。',
  },
] as const;
export const SOFTWARE_REQUIREMENTS = [
  {
    key: 'pages',
    title: 'React与TypeScript界面交付',
    text: '用已选React与TypeScript完成问题表单、列表和状态反馈，说明组件拆分、表单校验和可复验的交互样例。',
    type: 'must' as const,
    feature: 'signup',
  },
  {
    key: 'capacity',
    title: 'Node.js接口与权限校验',
    text: '用已选Node.js与TypeScript实现HTTP接口，按确认的权限规则校验输入与身份，说明错误处理和重复请求边界。',
    type: 'must' as const,
    feature: 'capacity',
  },
  {
    key: 'export',
    title: 'SQL数据建模与列表查询',
    text: '设计问题与操作记录的数据关系，使用SQL进行条件查询并支持CSV导出；具体数据库品牌仍需确认。',
    type: 'must' as const,
    feature: 'export',
  },
  {
    key: 'handover',
    title: '自动化测试与持续交付',
    text: '能提供关键流程与异常路径的自动化测试样例；CI工具和部署平台尚未确定，相关经验作为加分候选。',
    type: 'bonus' as const,
    feature: 'handover',
  },
  {
    key: 'ownership',
    title: 'Git协作与交付说明',
    text: '使用Git提交可审阅修改，说明本人项目职责、交付过程和维护文档，并配合核对项目记录。',
    type: 'must' as const,
    feature: 'signup',
  },
] as const;
export const SOFTWARE_RESUME_LINES = [
  '姓名：陈澈（虚构软件工程师）',
  '邮箱：software-fiction@example.invalid',
  '个人简介：参与Web应用开发，以下内容均为合成演示材料。',
  '问题台项目：使用React与TypeScript独立完成问题列表、表单校验与状态反馈，提供组件和交互验收样例。',
  '接口模块：参与Node.js接口联调；身份权限和重复请求处理由其他同事完成，本人职责需进一步说明。',
  '数据模块：设计问题与操作记录的数据关系，使用SQL完成条件查询与CSV导出。',
  '同一问题台项目摘要：项目时间为2024年4月至6月，使用Git提交页面与查询功能。',
  '同一问题台项目明细：项目时间为2024年5月至8月，参与代码评审并编写交付说明。',
  '补充说明：上述两处项目时间尚未校对，需要核实是否分别对应试运行和正式交付。',
];
export const SOFTWARE_RESUME = SOFTWARE_RESUME_LINES.join('\n');
