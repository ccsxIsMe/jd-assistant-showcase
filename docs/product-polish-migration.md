# 数据兼容与工程变更

本轮继续使用Next.js/React、AI SDK、Zod、React Flow和原生IndexedDB，无新增依赖、后端平台或状态库。实际版本与锁文件保留，pnpm12.15.0。修改前源码/文档备份在上级snapshots/before-fullsite-polish-20261027.zip；不含密钥和用户浏览器数据。

数据库从v2加法升级到v3：原workspaces、explorations、exploration-assets保留，仅增resume-reviews及demo-instances。upgrade只创建缺少Store，不清空、删除或重写旧记录。其他旧标签页占用时提示关闭重试，不修改安全设置。业务schemaVersion仍为1；demo和hiringNeed为可选新增字段，旧来源、研究、快照及岗位照常读取。

demo-instances只保存当前纸舟种子指针；重置不删除旧实例。来源Blob只存exploration-assets，快照继续引用来源版本。新材料JSON可选fixtureNotice用于展示来源；旧JSON无此字段也可校验。没有第二套平行研究业务模型。

发现并修复历史补丁问题：Zod默认对象被错误注入局部操作patch，导致已有方案的研究在关系删除后无法撤销。新patch不带业务默认值；撤销仅比较前后真正变化的字段，同时兼容过去前后相同的默认字段，不覆盖后续无关编辑。新增单元及浏览器回归。

旧generate/optimize URL按workspaceId/workspace/id转至任务或JD，缺少上下文进入岗位区域。/explore默认转/lab；/explore/{id}与显式?view=classic仍可打开经典资料编辑，保证旧媒体/快照流程。旧评分API、Schema、导出器与tests/legacy-v1保存兼容；新match页面替换旧表单，不并行展示。

旧设计工具案例的合成完整数据被归档为tests/fixtures/legacy-design-tool.json。旧浏览器回归从明确标记的历史fixture做测试前置，再操作真实页面；当前公开展示统一纸舟，不保留重复注入按钮。新纸舟端到端从真实首页入口操作，不能把历史fixture设置过程算作用户端到端创建。

无真实模型调用授权扩展；本轮未验证新简历提示词在收费模型下的语义表现。历史真实联调文档只描述当时版本，不作为本轮新功能效果依据。
