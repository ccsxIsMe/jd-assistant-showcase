import type { ExploreSource } from './model';
export const IMAGE_PARSE_NOTICE =
  '原图已保存，尚未识别画面。在需求实验室点击“查看标注”→“提取图像文字与标注候选”，确认发送后识图；核对并接受候选标注后，再运行关联分析。也可手动补充说明。';
export function sourceParseNotice(source: Pick<ExploreSource, 'kind' | 'error'>) {
  // Display compatibility only: do not rewrite saved source versions or snapshots.
  return source.kind === 'image' &&
    source.error === '原图可预览；尚无视觉模型/OCR，请手动标注并填写说明。'
    ? IMAGE_PARSE_NOTICE
    : source.error;
}
