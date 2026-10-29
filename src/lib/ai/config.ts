import { modeSchema } from '../schemas';
export class PublicError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}
/**
 * 服务端配置读取；返回值含密钥，不得整体序列化到响应、日志或浏览器存储。
 * env 参数用于隔离测试，不需要读取开发者的真实 .env.local。
 */
export function readConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = modeSchema.safeParse(env.AI_MODE ?? 'mock');
  if (!parsed.success) throw new PublicError('AI_MODE 配置无效，应为 mock 或 real。', 503);
  const mode = parsed.data;
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  const model = env.DEEPSEEK_MODEL?.trim();
  const baseURL = env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com';
  try {
    const url = new URL(baseURL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error();
  } catch {
    throw new PublicError('DEEPSEEK_BASE_URL 必须为不含凭据、查询参数的HTTPS接口地址。', 503);
  }
  if (mode === 'real' && (!apiKey || !model))
    throw new PublicError('真实模式缺少 DEEPSEEK_API_KEY 或 DEEPSEEK_MODEL，请在服务端配置。', 503);
  return { mode, apiKey, model, baseURL };
}
