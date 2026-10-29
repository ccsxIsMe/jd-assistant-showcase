import type { Exploration } from '@/lib/exploration/model';
export type GuidedActions = {
  project: Exploration;
  update: (fn: (p: Exploration) => Exploration) => boolean;
  readonly: boolean;
  busy: boolean;
  onAdd: (kind?: 'text' | 'url' | 'file') => void;
  onSource: (id: string, evidenceId?: string) => void;
  onAnnotation: (id: string) => void;
  onEdit: (nodeId: string) => void;
  onEdge: (id: string) => void;
  onFocus: (nodeId: string) => void;
  onAnalyze: (
    stage: 'derive_features' | 'link_evidence' | 'propose_roles',
    scope?: string[],
  ) => void;
  onImport: () => void;
  onSnapshot: () => void;
  onExport: (kind: 'package' | 'material') => void;
  onHistory: () => void;
  onAnswer?: (id: string) => void;
};
