import 'server-only';
import { createHash } from 'node:crypto';
import { readConfig } from './config';
export function modelIdentity(mode: 'example' | 'real') {
  if (mode === 'example')
    return {
      provider: 'mock',
      model: 'built-in-product-example',
      configurationId: 'exploration-example@1.0.0',
    };
  const { model, baseURL } = readConfig();
  return {
    provider: 'deepseek',
    model: model ?? '未配置',
    configurationId: createHash('sha256')
      .update(`deepseek:${model}:${baseURL}`)
      .digest('hex')
      .slice(0, 20),
  };
}
