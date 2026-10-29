'use client';
import { IMAGE_PARSE_NOTICE } from './media-capabilities';
import { parseDocumentDetails } from '../documents/parse';
import { createSource, paragraphs, textEvidence } from './domain';
import { makeId, timestamp, type Evidence, type ExploreSource, type SourceVersion } from './model';
import { explorationStore } from './storage';
export const ACCEPT_MATERIALS = '.png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.markdown,.mp4';
const mimeTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mp4: 'video/mp4',
};
export function validateMaterial(file: { name: string; size: number; type: string }) {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const mime = mimeTypes[ext];
  if (!mime)
    throw new Error(
      '仅支持PNG、JPG、WebP、PDF、DOCX、TXT、Markdown和MP4；不支持旧.doc、音频或SVG。',
    );
  if (!file.size) throw new Error('文件为空。');
  const limit = ext === 'mp4' ? 30 : mime.startsWith('image/') ? 8 : 10;
  if (file.size > limit * 1024 * 1024) throw new Error(`该类文件超过${limit}MB限制。`);
  const compatible =
    !file.type ||
    file.type === 'application/octet-stream' ||
    file.type === mime ||
    (['md', 'markdown', 'txt'].includes(ext) && file.type.startsWith('text/')) ||
    (ext === 'docx' && file.type === 'application/zip');
  if (!compatible) throw new Error('文件类型与扩展名不一致。');
  return {
    ext,
    mime,
    kind:
      ext === 'mp4'
        ? ('video' as const)
        : mime.startsWith('image/')
          ? ('image' as const)
          : ('document' as const),
  };
}
export async function validateSignature(blob: Blob, mime: string) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(bytes);
  const valid =
    mime === 'image/png'
      ? bytes[0] === 137 && ascii.slice(1, 4) === 'PNG'
      : mime === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === 'image/webp'
          ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
          : mime === 'video/mp4'
            ? ascii.slice(4, 8) === 'ftyp'
            : mime === 'application/pdf'
              ? ascii.startsWith('%PDF-')
              : mime.includes('wordprocessingml')
                ? bytes[0] === 80 && bytes[1] === 75
                : true;
  if (!valid) throw new Error('文件签名不匹配，可能损坏或类型伪装。');
}
async function videoDetails(
  blob: Blob,
  signal: AbortSignal,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const failed = () => {
      cleanup();
      reject(new Error('MP4无法解码或已损坏；请换用浏览器支持的MP4，或提供关键截图。'));
    };
    const aborted = () => {
      cleanup();
      reject(new Error('已取消视频解析。'));
    };
    const timer = setTimeout(failed, 12000);
    signal.addEventListener('abort', aborted, { once: true });
    video.onloadedmetadata = () => {
      const { duration, videoWidth: width, videoHeight: height } = video;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600 || !width || !height)
        reject(new Error('仅支持10分钟以内且有可解码画面的MP4。'));
      else resolve({ duration, width, height });
    };
    video.onerror = failed;
    video.preload = 'metadata';
    video.src = url;
  });
}
export async function ingestFile(
  projectId: string,
  file: File,
  signal: AbortSignal,
  previous?: ExploreSource,
) {
  const { mime, ext, kind } = validateMaterial(file);
  await validateSignature(file, mime);
  signal.throwIfAborted();
  const source = previous ? structuredClone(previous) : createSource(kind, file.name);
  source.kind = kind;
  source.status = 'parsing';
  source.error = '';
  const version: SourceVersion = {
    revision: source.versions.at(-1)!.revision,
    text: '',
    paragraphs: [],
    createdAt: timestamp(),
    assetId: makeId(),
    fileName: file.name.slice(0, 300),
    size: file.size,
    mime,
  };
  await explorationStore.saveAsset({
    id: version.assetId!,
    explorationId: projectId,
    blob: file.slice(0, file.size, mime),
    name: file.name,
  });
  try {
    if (kind === 'image') {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      if (width * height > 24000000) throw new Error('图片超过2400万像素，请缩小后上传。');
      Object.assign(version, { width, height });
      source.status = 'partial';
      source.error = IMAGE_PARSE_NOTICE;
    } else if (kind === 'video') {
      Object.assign(version, await videoDetails(file, signal));
      source.status = 'partial';
      source.error = '视频可预览；请选择关键帧并填写说明，不进行自动抽帧或语音转写。';
    } else if (ext === 'pdf' || ext === 'docx') {
      const parsed = await parseDocumentDetails(file);
      version.text = parsed.text;
      version.pageCount = parsed.pageCount;
      version.paragraphs = parsed.pages.length
        ? parsed.pages.flatMap((page) => paragraphs(page.text, 'extracted', page.page))
        : paragraphs(parsed.text, 'extracted');
      source.status = 'ready';
    } else {
      version.text = (await file.text()).replace(/\u0000/g, '').trim();
      if (!version.text || version.text.includes('\uFFFD'))
        throw new Error('文本为空或编码不正确，请使用UTF-8文本。');
      version.paragraphs = paragraphs(version.text, 'extracted');
      source.status = 'ready';
    }
    signal.throwIfAborted();
  } catch (error) {
    source.status = 'error';
    source.error = signal.aborted
      ? '解析已取消；可重新解析或替换文件。'
      : error instanceof Error
        ? error.message
        : '解析失败，请补充文字。';
  }
  source.versions = [...source.versions.slice(0, -1), version];
  const evidence: Evidence[] = source.status === 'error' ? [] : textEvidence(source, version);
  return { source, version, evidence };
}
export function addUserIntent(source: ExploreSource) {
  const version = source.versions.at(-1)!;
  const text = [
    source.borrow && `明确希望借鉴：${source.borrow}`,
    source.avoid && `明确不借鉴：${source.avoid}`,
    source.referencePurpose && `参考目的：${source.referencePurpose}`,
  ]
    .filter(Boolean)
    .join('\n');
  if (text) version.paragraphs.push(...paragraphs(text, 'user'));
}
