import type { AIRequest } from './ai-contract';
import { related } from './domain';
import type { Workspace } from './model';
export function allowedTargetItems(req: AIRequest) {
  const target = req.context.items.find((item) => item.id === req.targetId);
  if (!target) return [];
  return req.scope === 'selected'
    ? [target]
    : [target, ...related(req.context as Workspace, target.id)];
}
