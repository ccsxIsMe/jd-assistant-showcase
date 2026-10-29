import { validateMaterial } from './files';
const imageExtensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
export function clipboardImages(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const files = Array.from(data.files ?? []);
  const candidates = files.length
    ? files
    : Array.from(data.items ?? []).flatMap((item) => {
        const file = item.kind === 'file' ? item.getAsFile() : null;
        return file ? [file] : [];
      });
  return candidates.filter(
    (file) =>
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp|avif|heic|svg)$/i.test(file.name),
  );
}
export function preparePastedImages(files: File[], currentCount = 0): File[] {
  if (!files.length)
    throw new Error(
      '剪贴板没有图片文件。请复制图片本身或截图，再按Ctrl+V；复制图片地址不会带上图片。',
    );
  if (currentCount + files.length > 10) throw new Error('每次最多添加10份文件，请先移除部分文件。');
  return files.map((file, index) => {
    const ext = imageExtensions[file.type];
    const normalized =
      ext && !/\.[a-z0-9]+$/i.test(file.name)
        ? new File([file], `粘贴图片-${index + 1}.${ext}`, {
            type: file.type,
            lastModified: file.lastModified,
          })
        : file;
    if (validateMaterial(normalized).kind !== 'image')
      throw new Error('请粘贴PNG、JPG或WebP图片。');
    return normalized;
  });
}
