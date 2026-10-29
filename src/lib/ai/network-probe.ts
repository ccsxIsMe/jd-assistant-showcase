import 'server-only';
import { readConfig } from './config';

// Connectivity only: never add credentials or user material and never call chat/completions.
export async function probeAiNetwork(signal: AbortSignal) {
  const cfg = readConfig({ ...process.env, AI_MODE: 'mock' });
  const endpoint = `${cfg.baseURL.replace(/\/+$/, '')}/models`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  await response.body?.cancel();
  return {
    ok: true,
    code: 'NETWORK_REACHABLE',
    httpStatus: response.status,
    message: `已收到配置接口的HTTPS响应（HTTP ${response.status}）。本次未携带密钥，未调用模型；401在此仅表示未认证，不代表你的密钥无效。模型与认证仍需单独测试。`,
  };
}
