import { MAX_FILE, MAX_TEXT } from '../schemas';
export function validateFile(file: { name: string; size: number; type: string }) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'pdf' && ext !== 'docx') throw new Error('仅支持 PDF 和 DOCX，不支持旧版 .doc。');
  if (file.size === 0) throw new Error('文件为空，请重新选择。');
  if (file.size > MAX_FILE) throw new Error('文件超过10MB限制。');
  const allowed =
    ext === 'pdf'
      ? ['application/pdf']
      : [
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/zip',
        ];
  if (file.type && file.type !== 'application/octet-stream' && !allowed.includes(file.type))
    throw new Error('文件类型与扩展名不一致。');
  return ext;
}
export function validateExtractedText(value: string) {
  const text = value.replace(/\u0000/g, '').trim();
  if (text.length < 10)
    throw new Error('未提取到足够文字，可能是扫描件；本轮不支持OCR，请粘贴或补充简历文本。');
  if (text.length > MAX_TEXT)
    throw new Error(`解析文本超过${MAX_TEXT}字限制，请精简文件或直接粘贴相关内容。`);
  if ((text.match(/\uFFFD/g)?.length ?? 0) > text.length * 0.03)
    throw new Error('提取内容疑似乱码，请粘贴正确文本。');
  return text;
}
