'use client';
import { validateExtractedText, validateFile } from './validation';
export async function parseResume(file: File): Promise<string> {
  return (await parseDocumentDetails(file)).text;
}
export async function parseDocumentDetails(
  file: File,
): Promise<{ text: string; pages: { page: number; text: string }[]; pageCount?: number }> {
  const ext = validateFile(file);
  const buffer = await file.arrayBuffer();
  const signature = new Uint8Array(buffer.slice(0, 5));
  if (ext === 'pdf' && new TextDecoder().decode(signature) !== '%PDF-')
    throw new Error('PDF文件签名无效，文件可能损坏。');
  if (ext === 'docx' && (signature[0] !== 80 || signature[1] !== 75))
    throw new Error('DOCX文件签名无效，文件可能损坏。');
  let result: string;
  const pageDetails: { page: number; text: string }[] = [];
  let pageCount: number | undefined;
  try {
    if (ext === 'docx') {
      const mammoth = await import('mammoth');
      result = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
    } else {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({
        data: buffer,
        cMapUrl: '/pdf-cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdf-fonts/',
        useWasm: false,
      });
      task.onPassword = () => {
        void task.destroy();
      };
      let pdf;
      try {
        pdf = await task.promise;
      } catch {
        throw new Error('PDF无法读取，可能损坏或已加密；请使用未加密文件或粘贴文字。');
      }
      try {
        if (pdf.numPages > 50) throw new Error('PDF超过50页，请精简后重试。');
        pageCount = pdf.numPages;
        const pages: string[] = [];
        let length = 0;
        for (let page = 1; page <= pdf.numPages; page++) {
          const content = await (await pdf.getPage(page)).getTextContent();
          const text = content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
            .join('');
          length += text.length;
          if (length > 30000) throw new Error('解析文本超过30000字限制，请精简后重试。');
          pages.push(text);
          pageDetails.push({ page, text });
        }
        result = pages.join('\n');
      } finally {
        await task.destroy();
      }
    }
  } catch (error) {
    if (ext === 'docx')
      throw new Error('DOCX解析失败，文件可能损坏或已加密；请重新保存或粘贴文本。');
    throw error;
  }
  return { text: validateExtractedText(result), pages: pageDetails, pageCount };
}
