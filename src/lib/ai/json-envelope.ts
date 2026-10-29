// 草稿仅随错误对象暂存在内存；不附到公开错误、日志或持久化记录中。
const repairDrafts = new WeakMap<object, unknown>();
export function rememberJSONDraft(error: object, draft: unknown) {
  repairDrafts.set(error, draft);
}
export function jsonRepairDraft(error: unknown) {
  return error && typeof error === 'object' ? repairDrafts.get(error) : undefined;
}
/** 仅移除 BOM 和完整外层代码围栏；不修补引号、括号或被截断的 JSON。 */
export function decodeJSONEnvelope(text: string): unknown {
  if (text.length > 100000) throw new SyntaxError('JSON response exceeds limit');
  let document = text.replace(/^\uFEFF/, '').trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(document);
  if (fenced) document = fenced[1].trim();
  return JSON.parse(document);
}
