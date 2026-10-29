import { request } from '@playwright/test';
export default async function setup() {
  const client = await request.newContext();
  try {
    const baseURL = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000');
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(baseURL.hostname) ||
      baseURL.protocol !== 'http:'
    )
      throw new Error('浏览器回归只允许本机HTTP测试服务。');
    const response = await client.get(new URL('/api/status', baseURL).href);
    const data = await response.json();
    if (data.mode !== 'mock')
      throw new Error(
        "浏览器回归仅允许mock服务，已在模型调用前停止。请在测试服务终端设置 $env:AI_MODE='mock' 后启动；不要修改真实密钥文件。真实联调请显式使用 pnpm test:live。",
      );
  } finally {
    await client.dispose();
  }
}
