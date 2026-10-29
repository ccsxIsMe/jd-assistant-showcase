import { afterEach, expect, it, vi } from 'vitest';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
vi.mock('server-only', () => ({}));
import { decodePageBody, extractHTML } from '../../src/lib/exploration/web';
import { clipboardImages, preparePastedImages } from '../../src/lib/exploration/clipboard';
import { referenceLink } from '../../src/lib/exploration/reference-link';
import { urlSource } from '../../src/lib/exploration/sources';
import { explorationError } from '../../src/lib/exploration/http';
import { PublicError } from '../../src/lib/ai/config';
import {
  sourceParseNotice,
  IMAGE_PARSE_NOTICE,
} from '../../src/lib/exploration/media-capabilities';
afterEach(() => vi.restoreAllMocks());
it('旧图片提示仅在展示时兼容更新，不改历史资料或掩盖真实解析错误', () => {
  const old = {
      kind: 'image' as const,
      error: '原图可预览；尚无视觉模型/OCR，请手动标注并填写说明。',
    },
    before = JSON.stringify(old);
  expect(sourceParseNotice(old)).toBe(IMAGE_PARSE_NOTICE);
  expect(JSON.stringify(old)).toBe(before);
  expect(sourceParseNotice({ ...old, error: '图片损坏' })).toBe('图片损坏');
});
it.each([
  ['gzip', gzipSync],
  ['deflate', deflateSync],
  ['br', brotliCompressSync],
] as const)('实际解压%s网页并提取正文', async (encoding, compress) => {
  const html = Buffer.from(
    '<html><title>压缩页面</title><body><main><p>网页文字不代表视频画面。</p></main></body></html>',
  );
  const decoded = await decodePageBody(compress(html), encoding);
  expect(extractHTML(decoded, 'text/html; charset=utf-8').text).toBe('网页文字不代表视频画面。');
});
it('同时限制传输大小和解压后大小，压缩炸弹不绕过限制', async () => {
  await expect(decodePageBody(Buffer.alloc(3 * 1024 * 1024 + 1))).rejects.toMatchObject({
    status: 413,
  });
  const bomb = gzipSync(Buffer.alloc(3 * 1024 * 1024 + 1, 65));
  expect(bomb.length).toBeLessThan(10000);
  await expect(decodePageBody(bomb, 'gzip')).rejects.toMatchObject({ status: 413 });
});
it('损坏或未知压缩格式明确拒绝', async () => {
  await expect(decodePageBody(Buffer.from('bad gzip'), 'gzip')).rejects.toThrow('损坏');
  await expect(decodePageBody(Buffer.from('unsupported'), 'unknown')).rejects.toThrow('不支持');
});
it('清理B站跟踪参数但保留分P信息，其他域名不冒充视频来源', () => {
  const reference = referenceLink(
    'https://www.bilibili.com/video/BV1test/?p=2&spm_id_from=tracking&vd_source=tracking',
  );
  expect(reference.video).toBe(true);
  expect(reference.url).toBe('https://www.bilibili.com/video/BV1test/?p=2');
  expect(referenceLink('https://bilibili.com.evil.example/video/BV1test/').video).toBe(false);
});
it('剪贴板文件与items回退均可读取，普通文字粘贴不被截获', () => {
  const png = new File(['png'], 'image.png', { type: 'image/png' });
  const data = {
    files: [png],
    items: [{ kind: 'file', getAsFile: () => png }],
  } as unknown as DataTransfer;
  expect(clipboardImages(data)).toEqual([png]);
  expect(clipboardImages({ ...data, files: [] as unknown as FileList })).toEqual([png]);
  expect(
    clipboardImages({
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
    }),
  ).toEqual([]);
});
it('无扩展名图片按真实MIME补名，类型、大小与数量限制不因粘贴绕过', () => {
  expect(preparePastedImages([new File(['png'], 'image', { type: 'image/png' })])[0].name).toMatch(
    /\.png$/,
  );
  expect(() =>
    preparePastedImages([new File(['svg'], 'test.svg', { type: 'image/svg+xml' })]),
  ).toThrow('仅支持');
  expect(() =>
    preparePastedImages([
      new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
    ]),
  ).toThrow('8MB');
  expect(() =>
    preparePastedImages([new File(['png'], 'image.png', { type: 'image/png' })], 10),
  ).toThrow('10份');
  expect(() => preparePastedImages([])).toThrow('没有图片文件');
});
it('视频网页成功也只标为部分资料，不声称分析过视频内容', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      title: '公开视频',
      text: '仅页面文字',
      normalizedUrl: 'https://www.bilibili.com/video/BV1test/',
      fetchedAt: new Date().toISOString(),
      status: 'ready',
    }),
  );
  const source = await urlSource(
    'https://www.bilibili.com/video/BV1test/',
    new AbortController().signal,
  );
  expect(source.status).toBe('partial');
  expect(source.error).toContain('不自动提取字幕');
  expect(source.versions[0].text).toBe('仅页面文字');
});
it('网页失败保留HTTP、错误码和请求编号，长链接不超过来源标题上限', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(
      { error: '目标网站返回HTTP 412', code: 'WEB_UNAVAILABLE', requestId: 'public-test-request' },
      { status: 422 },
    ),
  );
  const source = await urlSource(
    'https://example.com/' + 'long-path'.repeat(100),
    new AbortController().signal,
  );
  expect(source.status).toBe('error');
  expect(source.error).toContain('public-test-request');
  expect(source.error).toContain('WEB_UNAVAILABLE');
  expect(source.title.length).toBeLessThanOrEqual(200);
  expect(source.versions[0].text).toBe('');
});
it('网页读取错误不标成DeepSeek配置故障，不泄露内部异常', async () => {
  const bounded = await explorationError(
    new PublicError('响应过大', 413),
    'fixed-id',
    new AbortController().signal,
    'web',
  ).json();
  expect(bounded.code).toBe('WEB_TOO_LARGE');
  const network = await explorationError(
    new Error('private internals'),
    'fixed-id',
    new AbortController().signal,
    'web',
  ).json();
  expect(network.code).toBe('WEB_NETWORK');
  expect(network.error).not.toContain('private internals');
});
