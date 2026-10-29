import { PublicError } from '../ai/config';
import { modelError } from '../ai/errors';
import { ZodError } from 'zod';
export async function readBoundedJSON(request: Request, limit = 1000000) {
  const origin = request.headers.get('origin');
  const requestURL = new URL(request.url);
  const host = request.headers.get('host');
  // Next may construct request.url with "localhost" even when the browser uses 127.0.0.1.
  // Browser Host is authoritative here; do not trust arbitrary forwarded-host headers.
  const expected = host ? new URL(`${requestURL.protocol}//${host}`).origin : requestURL.origin;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(expected).hostname))
    throw new PublicError('本机工作台不接受非本机Host请求。', 403);
  if (origin && origin !== expected) throw new PublicError('仅允许从本应用发起操作。', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new PublicError('请求必须为JSON。', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new PublicError('请求为空。', 422);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PublicError('本次资料超过请求大小限制，请精简。', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new PublicError('无效JSON。', 422);
  }
}
export function explorationError(
  error: unknown,
  requestId: string,
  signal: AbortSignal,
  context: 'web' | 'ai',
) {
  const safe = modelError(error, signal);
  const status =
    error instanceof PublicError
      ? error.status
      : error instanceof ZodError
        ? 422
        : context === 'web'
          ? signal.aborted
            ? 408
            : 502
          : safe.status;
  const message =
    error instanceof PublicError
      ? error.message
      : error instanceof ZodError
        ? '输入或返回结构不合法，原始数据保留。'
        : context === 'web'
          ? signal.aborted
            ? '网页抓取超时或已取消，请补充文字或重试。'
            : '网页无法连接或不支持基础解析，请补充截图、文档或文字。'
          : safe.message;
  return Response.json(
    {
      error: message,
      code:
        error instanceof ZodError
          ? 'INVALID_INPUT'
          : context === 'web'
            ? signal.aborted
              ? 'WEB_TIMEOUT'
              : error instanceof PublicError
                ? error.status === 413
                  ? 'WEB_TOO_LARGE'
                  : 'WEB_UNAVAILABLE'
                : 'WEB_NETWORK'
            : safe.code,
      requestId,
      ...(context === 'ai' && safe.validationIssues?.length
        ? { validationIssues: safe.validationIssues, attempts: safe.attempts }
        : {}),
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
