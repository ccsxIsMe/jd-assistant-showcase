// Normalize transport wrappers only. Never repair quotes, missing braces or content.
const repairDrafts = new WeakMap<object, unknown>();
export function rememberJSONDraft(error: object, draft: unknown) {
  repairDrafts.set(error, draft);
}
export function jsonRepairDraft(error: unknown) {
  return error && typeof error === 'object' ? repairDrafts.get(error) : undefined;
}
export function decodeJSONEnvelope(text: string): unknown {
  if (text.length > 100000) throw new SyntaxError('JSON response exceeds limit');
  let document = text.replace(/^\uFEFF/, '').trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(document);
  if (fenced) document = fenced[1].trim();
  return JSON.parse(document);
}
