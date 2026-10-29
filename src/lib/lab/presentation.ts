import type { Exploration } from '../exploration/model';
import { visibleGraph, sourceNodeId } from './graph';
import { orderedQuestions } from './guided';
// A projection only. Never writes nodes, relationships, status, or coordinates.
export function boardPresentation(
  p: Exploration,
  density: 'core' | 'all',
  zoom: number,
  focused = false,
) {
  const lab = p.lab!,
    graph = visibleGraph(lab);
  if (focused || (density === 'all' && zoom >= 0.4)) return graph;
  const primary = p.findings
    .filter((f) => f.status !== 'excluded' && f.kind === 'feature')
    .sort(
      (a, b) =>
        ({ high: 0, medium: 1, low: 2 })[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority],
    )
    .slice(0, zoom < 0.4 ? 3 : 6);
  const primaryIds = new Set(primary.map((f) => f.id)),
    proof = new Set(primary.flatMap((f) => f.evidenceIds));
  const questions = new Set(
    orderedQuestions(p)
      .filter(
        (q) =>
          q.priority.level === 'high' ||
          (zoom >= 0.4 && q.findingIds.some((id) => primaryIds.has(id))),
      )
      .slice(0, 3)
      .map((q) => q.id),
  );
  const keep = new Set(
    graph.nodes
      .filter((n) => {
        switch (n.type) {
          case 'source':
            return (
              n.status !== 'excluded' &&
              (p.sources.find((s) => s.id === n.content.sourceId)?.purpose === 'main' ||
                n.evidenceIds.some((id) => proof.has(id)))
            );
          case 'feature':
            return (
              primaryIds.has(n.content.findingId) ||
              p.findings.some((f) => f.id === n.content.findingId && f.kind === 'conflict')
            );
          case 'evidence':
            return (
              zoom >= 0.4 &&
              (lab.pinnedEvidenceIds.includes(n.content.evidenceId) ||
                proof.has(n.content.evidenceId))
            );
          case 'question':
            return questions.has(n.content.questionId);
          case 'inference':
            return (
              zoom >= 0.4 &&
              p.findings.some((f) => f.id === n.content.findingId && f.priority === 'high')
            );
          case 'role':
            return zoom >= 0.4 && lab.activeSolutionIds.includes(n.content.solutionId);
          case 'requirement':
            return (
              zoom >= 0.4 &&
              n.status === 'confirmed' &&
              lab.activeSolutionIds.includes(n.content.solutionId)
            );
        }
      })
      .map((n) => n.id),
  );
  for (const edge of graph.edges.filter(
    (e) => e.relationType === 'conflicts_with' && e.status !== 'deleted',
  )) {
    for (const id of [edge.sourceNodeId, edge.targetNodeId]) {
      const node = lab.nodes.find((n) => n.id === id);
      if (node?.type === 'evidence') {
        keep.add(sourceNodeId(node.content.sourceId));
        if (zoom >= 0.4) keep.add(id);
      } else keep.add(id);
    }
    for (const id of edge.evidenceRefs) {
      const source = p.evidence.find((e) => e.evidenceId === id)?.sourceId;
      if (source) keep.add(sourceNodeId(source));
    }
  }
  function physical(id: string) {
    if (keep.has(id)) return id;
    const n = lab.nodes.find((n) => n.id === id);
    return n?.type === 'evidence' ? sourceNodeId(n.content.sourceId) : id;
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges
      .map((e) => ({
        ...e,
        displaySource: physical(e.sourceNodeId),
        displayTarget: physical(e.targetNodeId),
      }))
      .filter(
        (e) =>
          keep.has(e.displaySource) &&
          keep.has(e.displayTarget) &&
          e.displaySource !== e.displayTarget &&
          (e.strengthClass === 'strong' ||
            e.relationType === 'conflicts_with' ||
            ['supports', 'inferred_from', 'implies', 'depends_on'].includes(e.relationType)),
      ),
  };
}
