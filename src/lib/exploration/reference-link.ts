export function referenceLink(value: string) {
  try {
    const url = new URL(value.trim());
    const bilibili = url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com');
    const video = bilibili && /^\/video\/(BV[\w]+|av\d+)/i.test(url.pathname);
    if (bilibili)
      for (const key of [...url.searchParams.keys()])
        if (
          /^(spm_id_from|vd_source|share_source|share_medium|share_plat|share_session_id|utm_.*)$/i.test(
            key,
          )
        )
          url.searchParams.delete(key);
    return {
      url: url.href,
      video,
      title: video ? `B站视频 · ${url.pathname.split('/')[2]}` : url.hostname,
    };
  } catch {
    return { url: value.trim(), video: false, title: value.trim().slice(0, 200) };
  }
}
export const VIDEO_LINK_NOTICE =
  '这是视频播放页；网页文字不代表视频内容。当前不下载远程视频、不自动提取字幕或理解画面，请粘贴关键截图并补充说明，或上传有权使用的MP4。';
export function safePublicHref(value: string | undefined) {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
