'use client';
import { validateMaterial, validateSignature } from '../exploration/files';
import { uid, type Source } from './model';
export type SourceImage = NonNullable<Source['versions'][number]['image']>;
export async function prepareSourceImage(file: File): Promise<SourceImage> {
  const { kind, mime } = validateMaterial(file);
  if (kind !== 'image') throw new Error('请上传PNG、JPG或WebP图片。');
  await validateSignature(file, mime);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片损坏或无法解码，请换一张PNG、JPG或WebP图片。');
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (!width || !height || width * height > 24000000)
    throw new Error('图片超过2400万像素，请缩小后上传。');
  return {
    assetId: uid(),
    filename: file.name.slice(0, 300),
    mime: mime as SourceImage['mime'],
    size: file.size,
    width,
    height,
  };
}
