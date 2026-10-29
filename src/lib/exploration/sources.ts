'use client';
import { createSource, paragraphs } from './domain';
import { timestamp } from './model';
import { readAIResponse, AIRequestError } from '../workbench/request-error';
import { referenceLink, VIDEO_LINK_NOTICE } from './reference-link';
export function ideaSource(title: string, text: string) {
  const source = createSource('text', title);
  const value = text.trim();
  if (!value) throw new Error('请填写想法或描述。');
  source.versions[0].text = value;
  source.versions[0].paragraphs = paragraphs(value, 'user');
  source.status = 'ready';
  return source;
}
export async function urlSource(url: string, signal: AbortSignal, title = '') {
  const reference = referenceLink(url);
  url = reference.url;
  const source = createSource('url', (title || reference.title).slice(0, 200));
  source.versions[0].originalUrl = url;
  try {
    const response = await fetch('/api/exploration/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });
    const data = await readAIResponse(response);
    if (typeof data.text !== 'string' || typeof data.normalizedUrl !== 'string')
      throw new Error('网页解析返回格式不正确。');
    source.title = title.trim() || String(data.title).slice(0, 200);
    source.versions[0] = {
      revision: 1,
      text: data.text,
      paragraphs: paragraphs(data.text, 'extracted'),
      createdAt: timestamp(),
      originalUrl: url,
      normalizedUrl: data.normalizedUrl,
      fetchedAt: String(data.fetchedAt),
      description: String(data.description ?? ''),
      updatedAt: String(data.updatedAt ?? ''),
      screenshotStatus: 'not-available',
    };
    source.status = data.status === 'partial' || reference.video ? 'partial' : 'ready';
    source.error = [String(data.warning ?? ''), reference.video ? VIDEO_LINK_NOTICE : '']
      .filter(Boolean)
      .join('\n');
  } catch (error) {
    source.status = 'error';
    source.error = signal.aborted
      ? '网页解析已取消，可重新解析或补充文字。'
      : error instanceof AIRequestError
        ? `${error.message}\n错误码：${error.code} · HTTP ${error.status}${error.requestId ? ` · 请求编号：${error.requestId}` : ''}`
        : error instanceof Error
          ? error.message
          : '网页解析失败。';
  }
  return source;
}
