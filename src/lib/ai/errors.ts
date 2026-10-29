import { APICallError, NoOutputGeneratedError, NoObjectGeneratedError } from 'ai';
import { PublicError } from './config';
import type { ValidationIssue } from './validation';
export class ModelError extends PublicError {
  constructor(
    public code: string,
    message: string,
    status: number,
    public validationIssues?: ValidationIssue[],
    public attempts?: number,
  ) {
    super(message, status);
  }
}
const transportCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'EACCES',
  'EPERM',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);
export function transportFailure(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  for (let depth = 0; depth < 32 && pending.length; depth++) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current !== 'object') continue;
    const detail = current as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
      lastError?: unknown;
    };
    if (typeof detail.code === 'string' && transportCodes.has(detail.code)) return detail.code;
    pending.push(detail.cause, detail.lastError);
    if (Array.isArray(detail.errors)) pending.push(...detail.errors.slice(0, 16));
  }
}
export function modelError(error: unknown, signal?: AbortSignal): ModelError {
  if (error instanceof ModelError) return error;
  if (signal?.aborted)
    return new ModelError(
      signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
      '请求超时或已取消；已有编辑保留，可以重试。',
      408,
    );
  if (error instanceof PublicError)
    return new ModelError('CONFIGURATION', error.message, error.status);
  const transport = transportFailure(error);
  if (transport === 'EACCES' || transport === 'EPERM')
    return new ModelError(
      'NETWORK_DENIED',
      `服务进程的联网权限被拒绝（${transport}），尚未收到DeepSeek响应。请在允许联网的本机终端重启服务；已有编辑保留，无需重填密钥。`,
      502,
    );
  if (transport && /CERT|SIGNATURE|ISSUER/.test(transport))
    return new ModelError(
      'TLS_ERROR',
      `HTTPS证书校验失败（${transport}）；请检查系统时间、可信证书和网络代理，保持SSL校验开启。已有编辑保留。`,
      502,
    );
  if (transport)
    return new ModelError(
      transport.includes('TIMEOUT') || transport === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK',
      `服务器连接DeepSeek失败（${transport}）；已有编辑保留。请检查网络后重试，可在“AI连接”页测试。`,
      transport.includes('TIMEOUT') || transport === 'ETIMEDOUT' ? 504 : 502,
    );
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403)
      return new ModelError(
        'AUTHENTICATION',
        'DeepSeek认证失败，请在本机检查API Key；不要将密钥发送到聊天。',
        401,
      );
    if (status === 402)
      return new ModelError(
        'INSUFFICIENT_BALANCE',
        'DeepSeek账户余额不足，请在服务商控制台检查余额。',
        402,
      );
    if (status === 429) return new ModelError('RATE_LIMIT', 'DeepSeek请求受限，请稍后重试。', 429);
    if (status === 400 || status === 404 || status === 422)
      return new ModelError(
        'INVALID_CONFIGURATION',
        '模型名称、接口地址或请求参数不被服务商支持，请检查配置。',
        422,
      );
    if (!status)
      return new ModelError(
        'NETWORK',
        '服务器未收到DeepSeek响应，请在“AI连接”页测试后重试；已有编辑保留。',
        502,
      );
    return new ModelError(
      'UPSTREAM',
      `DeepSeek服务返回异常（上游HTTP ${status}）；已有编辑保留，请稍后重试。`,
      502,
    );
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === 'length')
      return new ModelError('OUTPUT_TRUNCATED', '模型输出被截断，请减少单次分析材料后重试。', 422);
    if (!error.text?.trim())
      return new ModelError('EMPTY_OUTPUT', '模型返回空内容；没有修改岗位数据。', 422);
    return new ModelError('INVALID_FORMAT', '模型JSON结构不合法；没有修改岗位数据。', 422);
  }
  if (NoOutputGeneratedError.isInstance(error))
    return new ModelError('EMPTY_OUTPUT', '模型返回空内容；没有修改岗位数据。', 422);
  if (error instanceof SyntaxError)
    return new ModelError('INVALID_FORMAT', '模型JSON结构不合法；没有修改岗位数据。', 422);
  if (error instanceof TypeError && error.message === 'fetch failed')
    return new ModelError(
      'NETWORK',
      '服务器无法连接DeepSeek，请检查网络后重试；已有编辑保留。',
      502,
    );
  return new ModelError('INTERNAL', '服务端处理异常；已有编辑保留，请附错误编号反馈。', 500);
}
