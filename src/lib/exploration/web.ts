import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { loadBuffer } from 'cheerio';
import { gunzip, inflate, brotliDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { PublicError } from '../ai/config';
const MAX_BYTES = 3 * 1024 * 1024;
const decompressors = {
  gzip: promisify(gunzip),
  deflate: promisify(inflate),
  br: promisify(brotliDecompress),
};
export async function decodePageBody(bytes: Buffer, encoding = 'identity') {
  if (bytes.byteLength > MAX_BYTES) throw new PublicError('网页响应超过3MB限制。', 413);
  const format = encoding.trim().toLowerCase();
  if (!format || format === 'identity') return bytes;
  if (!Object.hasOwn(decompressors, format))
    throw new PublicError('网页使用尚不支持的压缩格式，请补充文字或截图。', 422);
  try {
    return await decompressors[format as keyof typeof decompressors](bytes, {
      maxOutputLength: MAX_BYTES,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_BUFFER_TOO_LARGE'
    )
      throw new PublicError('网页解压后超过3MB限制。', 413);
    throw new PublicError('网页压缩内容损坏，无法读取正文；请重试或补充文字、截图。', 422);
  }
}
type Address = { address: string; family: number };
type PageResponse = { status: number; location?: string; bytes: Buffer; contentType: string };
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function normalizePublicURL(value: string) {
  if (value.length > 2000) throw new PublicError('网址过长。', 422);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicError('请填写完整的 http:// 或 https:// 公开网址。', 422);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new PublicError('仅允许无凭据、使用标准端口的HTTP/HTTPS公开网址。', 422);
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    !host ||
    (!host.includes('.') && !isIP(host)) ||
    /(^|\.)(localhost|local|internal|invalid|test|onion)$/.test(host) ||
    host.includes('%') ||
    (isIP(host) && !publicAddress(host))
  )
    throw new PublicError('禁止访问本机、内网、保留地址或云元数据地址。', 422);
  url.hash = '';
  return url;
}
async function resolveHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  return isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : lookup(host, { all: true, verbatim: true });
}
function readPage(url: URL, pinned: Address, signal: AbortSignal): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    // Pin the verified DNS answer on the actual connection. No secondary DNS lookup, proxy or pooled socket.
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        family: pinned.family,
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent': 'ProductExploration/1.0 public-page-reader',
        },
        maxHeaderSize: 16384,
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          resolve({ status, location, bytes: Buffer.alloc(0), contentType: '' });
          return;
        }
        if (status !== 200) {
          response.destroy();
          reject(
            new PublicError(`网页返回HTTP ${status}；未绕过访问限制，请补充截图或文字。`, 422),
          );
          return;
        }
        const contentType = response.headers['content-type'] ?? '';
        if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType)) {
          response.destroy();
          reject(new PublicError('该网址不是可解析的HTML网页，请直接上传文档或粘贴文字。', 422));
          return;
        }
        if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES) {
          response.destroy();
          reject(new PublicError('网页响应超过3MB限制。', 413));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) response.destroy(new PublicError('网页响应超过3MB限制。', 413));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          void decodePageBody(Buffer.concat(chunks), response.headers['content-encoding'])
            .then((bytes) => {
              signal.throwIfAborted();
              resolve({ status, contentType, bytes });
            })
            .catch(reject);
        });
        response.on('error', reject);
        response.on('aborted', () =>
          reject(new PublicError('网页读取中断，请重试或补充资料。', 502)),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}
export function extractHTML(bytes: Buffer, contentType = '') {
  if (bytes.byteLength > MAX_BYTES) throw new PublicError('网页响应超过3MB限制。', 413);
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1];
  const $ = loadBuffer(
    bytes,
    charset ? { encoding: { transportLayerEncodingLabel: charset } } : {},
  );
  const title =
    $('title').first().text().trim().slice(0, 200) ||
    $('h1').first().text().trim().slice(0, 200) ||
    '公开网页';
  const description = (
    $('meta[name="description"]').attr('content') ??
    $('meta[property="og:description"]').attr('content') ??
    ''
  ).slice(0, 2000);
  const updatedAt = (
    $('meta[property="article:modified_time"]').attr('content') ??
    $('meta[name="last-modified"]').attr('content') ??
    ''
  ).slice(0, 100);
  const accessForm = $('input[type="password"], [class*="captcha"], [id*="captcha"]').length > 0;
  $(
    'script,style,noscript,template,iframe,object,embed,svg,canvas,nav,footer,form,[hidden],[aria-hidden="true"]',
  ).remove();
  const root = $('main').first().length
    ? $('main').first()
    : $('article').first().length
      ? $('article').first()
      : $('body');
  const blocks = new Set<string>();
  root.find('h1,h2,h3,h4,p,li,dt,dd,blockquote').each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) blocks.add(text);
  });
  const all = [...blocks].join('\n') || root.text().replace(/\s+/g, ' ').trim();
  if (!all.trim())
    throw new PublicError('网页没有可提取正文，可能依赖动态脚本；请补充截图或文字。', 422);
  const partial = accessForm || all.length < 80 || all.length > 30000;
  return {
    title,
    description,
    updatedAt,
    text: all.slice(0, 30000),
    status: partial ? ('partial' as const) : ('ready' as const),
    warning: partial
      ? '正文可能不完整（动态内容、访问提示或长度限制）；仅已展示文字可作为证据，请人工校对。'
      : '',
    screenshotStatus: 'not-available' as const,
  };
}
export async function fetchPublicPage(
  value: string,
  signal: AbortSignal,
  dependencies: {
    resolve: (host: string) => Promise<Address[]>;
    read: (url: URL, address: Address, signal: AbortSignal) => Promise<PageResponse>;
  } = { resolve: resolveHost, read: readPage },
) {
  let url = normalizePublicURL(value);
  const originalUrl = url.href;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    bounded.throwIfAborted();
    const answers = await Promise.race([
      dependencies.resolve(url.hostname),
      new Promise<never>((_resolve, reject) => {
        if (bounded.aborted) reject(bounded.reason);
        else bounded.addEventListener('abort', () => reject(bounded.reason), { once: true });
      }),
    ]);
    if (!answers.length || answers.some((answer) => !publicAddress(answer.address)))
      throw new PublicError('DNS解析包含内网或保留地址，已阻止抓取。', 422);
    bounded.throwIfAborted();
    const response = await dependencies.read(url, answers[0], bounded);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects === 3)
        throw new PublicError('网页重定向过多或目标缺失。', 422);
      url = normalizePublicURL(new URL(response.location, url).href);
      continue;
    }
    return {
      ...extractHTML(response.bytes, response.contentType),
      originalUrl,
      normalizedUrl: url.href,
      fetchedAt: new Date().toISOString(),
    };
  }
  throw new PublicError('网页解析未完成。', 422);
}
