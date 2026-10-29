'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Download, FileText } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { exportMarkdown, modeLabel } from '@/lib/export';
import type { Mode } from '@/lib/schemas';
export function Heading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-7">
      <p className="mb-2 text-xs font-semibold tracking-widest text-teal-800">{eyebrow}</p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-500">{description}</p>
    </header>
  );
}
export function Field({
  label,
  id,
  children,
  hint,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-5 text-slate-500">{hint}</p>}
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {message}
    </div>
  ) : null;
}
export function EmptyResult() {
  return (
    <Card className="flex min-h-64 flex-col items-center justify-center border-dashed text-center">
      <FileText className="mb-4 text-teal-700" size={32} />
      <h2 className="font-medium text-slate-700">让每一份职位信息更清晰</h2>
      <p className="mt-2 text-sm text-slate-500">填写左侧信息后，结果将在这里展示。</p>
    </Card>
  );
}
export function Result({
  title,
  body,
  mode,
  children,
}: {
  title: string;
  body: string;
  mode: Mode;
  children?: React.ReactNode;
}) {
  const [message, setMessage] = useState('');
  const markdown = exportMarkdown(title, body, mode);
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setMessage('已复制');
    } catch {
      setMessage('复制失败，请手动选择正文复制');
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('已下载');
  }
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy size={15} />
            复制
          </Button>
          <Button variant="outline" onClick={download}>
            <Download size={15} />
            下载Markdown
          </Button>
        </div>
      </div>
      <p className="mb-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {modeLabel(mode)}
      </p>
      {children}
      <div className="markdown">
        <ReactMarkdown skipHtml>{body}</ReactMarkdown>
      </div>
      <p role="status" className="mt-3 text-xs text-teal-800">
        {message}
      </p>
    </Card>
  );
}
