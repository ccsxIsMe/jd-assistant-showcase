import Link from 'next/link';
import type { ValidationIssue } from '@/lib/ai/validation';
export type ErrorDetail = {
  code: string;
  requestId: string;
  status: number;
  validationIssues?: ValidationIssue[];
};
export function RequestErrorNotice({
  message,
  detail,
  onRetry,
  onDismiss,
  className = '',
}: {
  message: string;
  detail: ErrorDetail | null;
  onRetry: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={`request-error-notice ${className}`}>
      <p>{message}</p>
      {detail && (
        <small>
          HTTP {detail.status || '—'} · {detail.code}
          {detail.requestId && ` · 请求编号：${detail.requestId}`}
        </small>
      )}
      {!!detail?.validationIssues?.length && (
        <ul className="validation-issue-list">
          {detail.validationIssues.map((issue, index) => (
            <li key={`${issue.path}-${index}`}>
              <code>{issue.path}</code> · {issue.message} <small>（{issue.code}）</small>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button className="text-button" onClick={onRetry}>
          重试本次操作
        </button>
        <Link href="/settings/ai" target="_blank" rel="noreferrer">
          检查 AI 连接 ↗
        </Link>
        {onDismiss && (
          <button className="text-button" onClick={onDismiss}>
            收起
          </button>
        )}
      </div>
    </div>
  );
}
