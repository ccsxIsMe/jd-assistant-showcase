# 环境与启动

已验证：Windows PowerShell5.1、Node24.14.1、pnpm12.15.0，本机Edge用于浏览器回归。无需GPU、CUDA、独立后端或外部数据库。Node版本见 `.node-version`，包管理器版本见 `package.json#packageManager`，依赖解析固定于 `pnpm-lock.yaml`。

## 全新克隆

```powershell
pnpm install --frozen-lockfile
Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
pnpm dev
```

只在全新克隆且目标文件不存在时复制示例；已有配置请手工补充缺失项。默认mock无需密钥。安装后自动准备PDF.js worker、CMap和字体资源；这些第三方生成文件不进入Git。可运行 `pnpm prepare:pdf` 重新准备。

生产运行：`pnpm build` → `pnpm start`。访问 `http://127.0.0.1:3000`。开发使用Webpack模式，生产使用Next默认构建；不要并行向同一个构建目录运行开发与build。端口占用时复用已有同项目服务或选择空闲端口。

## 环境变量

| 名称                | 含义                             | 演示默认                 |
| ------------------- | -------------------------------- | ------------------------ |
| AI_MODE             | mock / real                      | mock                     |
| DEEPSEEK_API_KEY    | 只由服务端读取的凭据             | 空                       |
| DEEPSEEK_BASE_URL   | HTTPS服务接口，无凭据查询参数    | https://api.deepseek.com |
| DEEPSEEK_MODEL      | 服务端模型标识                   | deepseek-flash           |
| NEXT_VERIFY_BUILD   | 本机检查使用独立.next-verify输出 | 默认不设置               |
| PLAYWRIGHT_BASE_URL | 浏览器测试的本机服务地址         | http://127.0.0.1:3000    |

服务端读取实现为 `src/lib/ai/config.ts`，示例使用已核对并曾有限联调的模型标识；实际账号可用性仍由用户配置决定。真实Key只放本机 `.env.local`，不放仓库、聊天、前端变量或浏览器存储。配置改变后重启服务。

## 示例与浏览器

`public/demo/` 已包含虚构PNG、DOCX、文字和本地网页，可直接运行演示。`pnpm prepare:demo` 使用已安装的Edge重建新旧案例；普通展示无需重建。

浏览器测试默认使用 `msedge` channel。如果没有Edge，安装必要浏览器或按实际安装调整Playwright配置；生产应用本身不依赖Edge进行服务端渲染。当前只声明Windows本机验证，不宣称已完成所有系统或公网部署验证。
