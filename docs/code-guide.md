# 代码阅读与注释约定

注释重点解释业务边界、设计原因和异常行为；类型与简单控件已表达的含义不逐行重复。复杂函数通过JSDoc说明职责，关键分支说明为何不能简化。修改实现时须同步维护注释，注释不替代Schema与测试。

## 建议阅读顺序

| 关注点             | 入口                                                                                 | 必须保留的边界                                                                   |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 模型配置与调用     | `src/lib/ai/config.ts`、`adapter.ts`                                                 | 配置含密钥，仅供服务端读取；不序列化、不写日志。截断内容不得冒充完整JSON。       |
| 任务及受控修复     | `src/lib/ai/tasks/`、`workbench-service.ts`、`lab-service.ts`、`decision-service.ts` | 任务独立、修复有上限；网络/认证失败明确上报；真实失败不回退预置。                |
| 统一问题与答案     | `src/lib/decisions/records.ts`、`quality.ts`                                         | 相同标题不等于同一决策；保留别名、历史答案、稳定选项ID和版本。未知不是确认。     |
| 岗位候选与采纳     | `src/lib/workbench/ai-apply.ts`、`domain.ts`                                         | 服务端校验后仍检查锁定、引用与版本；人采纳后才改正文，已有JD不被新草稿覆盖。     |
| 研究阶段合并       | `src/lib/lab/workflow.ts`                                                            | 绑定输入对象版本，只增量合并有效结果；已取消任务拒绝迟到响应。                   |
| 图谱与关系         | `src/lib/lab/graph.ts`、`operations.ts`                                              | 保留坐标；显示投影不删除原证据。已删除关系保留记录，分析不静默恢复。             |
| 撤销与重做         | `src/lib/exploration/journal.ts`                                                     | 只撤销本操作影响的对象/字段；遇到后续编辑或依赖冲突则拒绝，不覆盖无关修改。      |
| 保存状态           | `src/hooks/use-exploration.ts`、`use-workspace.ts`、`src/lib/storage/database.ts`    | 内存编辑与落盘分开；事务完成才显示已保存，旧保存事件不能误报新编辑已保存。       |
| 快照与便携包       | `src/lib/exploration/research.ts`、`portable.ts`、`storage.ts`                       | 快照捕获深拷贝，附件按版本引用；导入校验并重绑ID，引用仍在时不清理附件。         |
| 岗位导入及上游同步 | `src/lib/exploration/workbench-import.ts`                                            | 研究确认不授予岗位确认；先计算差异，人选择同步后再次校验。                       |
| 网页和文件         | `src/lib/exploration/web.ts`、`src/lib/documents/parse.ts`                           | 每次重定向重新验证DNS并固定连接地址；文档提取纯文本，扫描件不伪装为OCR成功。     |
| 简历证据           | `src/lib/resume/domain.ts`                                                           | 标准与材料版本固定；引用必须定位。文本遮盖仅覆盖常见身份字段，不保证完整匿名化。 |

`graph.digest`和研究指纹用于本机变更比较，不是加密哈希或真实性证明。选项结构校验不能证明业务语义正确；证据可定位也不代表候选人的能力已核实。

## 公开包保留与清理原则

保留源码、提示词Schema/样例、锁文件、配置模板、有效测试和可重复演示材料。旧路由、纸舟案例及`tests/legacy-v1`仍与兼容有关，本轮没有为缩小包而移除它们，也没有删除测试制造通过结果。`AGENTS.md`是Next.js生成的贡献者说明，不包含运行凭据。

本轮移除三份未被package脚本、源码或文档引用的一次性工具：`audit-decision-entrypoints.mjs`、`smoke-configured-mode.mjs`、`prepare-local-env.mjs`。相应能力由已有浏览器回归和README环境配置步骤承接。另移除重复的纸舟旧版指南与内部打磨迁移日志；有效兼容信息合并到架构说明。

`pnpm check:public`检查当前发布清单、危险文件名、常见令牌、个人绝对路径与URL凭据，只输出规则及文件名。公开前另行核查Git历史、压缩文档、最终ZIP与实际配置密钥；真实配置只在私有审计进程内比较，不写入公开脚本、日志或快照。任何格式扫描都不能保证识别所有未知形式的秘密。
