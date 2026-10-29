import { validationIssueSchema, type ValidationIssue } from '../ai/validation';
export class AIRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public requestId = '',
    public status = 0,
    public validationIssues?: ValidationIssue[],
  ) {
    super(message);
  }
}
export async function readAIResponse(response: Response): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    data = parsed as Record<string, unknown>;
  } catch {
    throw new AIRequestError(
      `服务返回了无法读取的响应（HTTP ${response.status}），可能是网关或连接中断；已有编辑保留，请重试。`,
      'INVALID_RESPONSE',
      '',
      response.status,
    );
  }
  if (!response.ok)
    throw new AIRequestError(
      typeof data.error === 'string'
        ? data.error
        : `请求失败（HTTP ${response.status}），已有编辑保留。`,
      typeof data.code === 'string' ? data.code : 'REQUEST_FAILED',
      typeof data.requestId === 'string' ? data.requestId : '',
      response.status,
      Array.isArray(data.validationIssues)
        ? data.validationIssues.slice(0, 8).flatMap((issue) => {
            const parsed = validationIssueSchema.safeParse(issue);
            return parsed.success ? [parsed.data] : [];
          })
        : undefined,
    );
  return data;
}
