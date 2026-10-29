'use client';
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  MarkerType,
  useReactFlow,
  getViewportForBounds,
  type Connection,
  type NodeChange,
  type Viewport,
  type Edge,
} from '@xyflow/react';
import { Plus, Minus, Scan, Focus, Network, Filter, RotateCcw } from 'lucide-react';
import { BoardNode, type FlowBoardNode, type BoardNodeData } from './board-node';
import { evidenceChain, sourceNodeId } from '@/lib/lab/graph';
import { boardPresentation } from '@/lib/lab/presentation';
import {
  nodeTypes,
  nodeTypeNames,
  relationTypes,
  relationNames,
  type GraphEdge,
  type GraphNode,
} from '@/lib/lab/model';
import type { Exploration } from '@/lib/exploration/model';
import { evidenceValid } from '@/lib/exploration/domain';
const nodeComponents = { investigation: BoardNode };
type Props = {
  active?: boolean;
  onDensity: (density: 'core' | 'all') => void;
  project: Exploration;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onViewport: (viewport: Viewport) => void;
  onSelect: (id: string | null) => void;
  onEdge: (id: string) => void;
  onOpen: (id: string) => void;
  onSource?: (id: string) => void;
  onCollapse: (id: string) => void;
  onEvidence: (id: string) => void;
  onPin: (id: string) => void;
  onConnect: (source: string, target: string) => void;
  onRestoreFocus: () => void;
  onCompact?: () => boolean | undefined;
  onFilter: (
    types: GraphNode['type'][],
    relations: GraphEdge['relationType'][],
    status: string,
  ) => void;
};
function Canvas(props: Props) {
  const { project: p } = props,
    lab = p.lab!;
  const flow = useReactFlow<FlowBoardNode>();
  const images = p.sources.filter((s) => !s.removed && s.kind === 'image');
  const readyImages = images.filter((s) =>
    p.evidence.some((e) => e.sourceId === s.id && evidenceValid(p, e)),
  );
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [zoom, setZoom] = useState(lab.ui.viewport.zoom);
  const dragging = useRef(false);
  const surface = useRef<HTMLElement>(null);
  const pendingCompactFit = useRef(false);
  const originalViewport = useRef<Viewport | null>(null);
  const focused = useRef(lab.ui.focusedRequirementId);
  const viewportCommit = useRef(props.onViewport);
  useEffect(() => {
    focused.current = lab.ui.focusedRequirementId ?? lab.ui.focusTarget?.id ?? null;
    viewportCommit.current = props.onViewport;
  }, [lab.ui.focusedRequirementId, lab.ui.focusTarget, props.onViewport]);
  const chain = useMemo(
    () =>
      lab.ui.focusedRequirementId
        ? evidenceChain(lab, `requirement:${lab.ui.focusedRequirementId}`)
        : lab.ui.focusTarget?.kind === 'node'
          ? evidenceChain(lab, lab.ui.focusTarget.id)
          : lab.ui.focusTarget?.kind === 'edge'
            ? (() => {
                const e = lab.edges.find((e) => e.id === lab.ui.focusTarget!.id);
                return e
                  ? new Set([
                      e.sourceNodeId,
                      e.targetNodeId,
                      ...lab.nodes
                        .filter((n) => n.evidenceIds.some((id) => e.evidenceRefs.includes(id)))
                        .map((n) => n.id),
                    ])
                  : null;
              })()
            : null,
    [lab],
  );
  const activeNode = lab.nodes.find((n) => n.id === lab.ui.selectedNodeId);
  const graph = useMemo(
    () => boardPresentation(p, lab.ui.boardDensity, zoom, !!chain),
    [p, lab.ui.boardDensity, zoom, chain],
  );
  const fitAll = useCallback(() => {
    const element = surface.current;
    if (!element) return;
    // Use saved coordinates, including nodes omitted at the current zoom level.
    // Fitting only mounted nodes can miss newly visible nodes after zoom changes.
    const all = boardPresentation(p, lab.ui.boardDensity, 1, !!chain).nodes.filter(
      (n) =>
        (!lab.ui.filters.types.length || lab.ui.filters.types.includes(n.type)) &&
        (lab.ui.filters.status === 'all' || n.status === lab.ui.filters.status),
    );
    if (!all.length) return;
    const x = Math.min(...all.map((n) => n.layoutPosition.x));
    const y = Math.min(...all.map((n) => n.layoutPosition.y));
    const width = Math.max(...all.map((n) => n.layoutPosition.x + (sizes[n.id]?.width ?? 285))) - x;
    const height =
      Math.max(
        ...all.map(
          (n) =>
            n.layoutPosition.y +
            Math.max(sizes[n.id]?.height ?? 0, n.type === 'source' ? 390 : 250),
        ),
      ) - y;
    const box = element.getBoundingClientRect();
    void flow.setViewport(
      getViewportForBounds({ x, y, width, height }, box.width, box.height, 0.12, 0.9, 0.15),
      { duration: 0 },
    );
  }, [p, lab.ui, chain, sizes, flow]);
  useEffect(() => {
    if (!pendingCompactFit.current) return;
    pendingCompactFit.current = false;
    fitAll();
  }, [lab.nodes, fitAll]);
  const selectedPhysical =
    activeNode?.type === 'evidence' && !activeNode.content.independent
      ? sourceNodeId(activeNode.content.sourceId)
      : lab.ui.selectedNodeId;
  const callbacks = useMemo(
    () => ({
      onOpen: props.onOpen,
      onCollapse: props.onCollapse,
      onEvidence: props.onEvidence,
      onPin: props.onPin,
    }),
    [props.onOpen, props.onCollapse, props.onEvidence, props.onPin],
  );
  const edgeInFocus =
    lab.ui.focusTarget?.kind === 'edge'
      ? graph.edges.find((e) => e.id === lab.ui.focusTarget!.id)
      : undefined;
  const dataMap = useMemo(
    () =>
      new Map(
        graph.nodes.map((n) => [
          n.id,
          {
            node: n,
            source:
              n.type === 'source' ? p.sources.find((s) => s.id === n.content.sourceId) : undefined,
            evidence: p.evidence,
            annotations: lab.annotations,
            dimmed: !!chain && !chain.has(n.id),
            ...callbacks,
          } satisfies BoardNodeData,
        ]),
      ),
    [graph.nodes, p.sources, p.evidence, lab.annotations, chain, callbacks],
  );
  const nodes: FlowBoardNode[] = graph.nodes
    .filter(
      (n) =>
        (!lab.ui.filters.types.length || lab.ui.filters.types.includes(n.type)) &&
        (lab.ui.filters.status === 'all' || n.status === lab.ui.filters.status),
    )
    .map((n) => ({
      id: n.id,
      type: 'investigation',
      position: positions[n.id] ?? n.layoutPosition,
      measured: sizes[n.id],
      initialWidth: 285,
      initialHeight: n.type === 'source' ? 320 : 230,
      selected:
        n.id === selectedPhysical ||
        (!!edgeInFocus && [edgeInFocus.displaySource, edgeInFocus.displayTarget].includes(n.id)),
      dragHandle: '.lab-node-drag-handle',
      data: dataMap.get(n.id)!,
      ariaLabel: `${nodeTypeNames[n.type]}：${n.title}`,
      deletable: false,
    }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const selectedChain = useMemo(
    () => (lab.ui.selectedNodeId ? evidenceChain(lab, lab.ui.selectedNodeId) : null),
    [lab],
  );
  const edges: Edge[] = graph.edges
    .filter(
      (e) =>
        nodeIds.has(e.displaySource) &&
        nodeIds.has(e.displayTarget) &&
        (!lab.ui.filters.relations.length || lab.ui.filters.relations.includes(e.relationType)),
    )
    .map((e) => {
      const related = !chain || (chain.has(e.sourceNodeId) && chain.has(e.targetNodeId));
      const adjacent =
        !lab.ui.selectedNodeId ||
        [e.sourceNodeId, e.targetNodeId, e.displaySource, e.displayTarget].includes(
          lab.ui.selectedNodeId,
        ) ||
        (selectedChain?.has(e.sourceNodeId) && selectedChain?.has(e.targetNodeId));
      const color =
        e.strengthClass === 'conflict'
          ? '#b44c4e'
          : e.strengthClass === 'strong'
            ? '#407b76'
            : '#8e819e';
      return {
        id: e.id,
        source: e.displaySource,
        target: e.displayTarget,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'smoothstep',
        selected: e.id === lab.ui.selectedEdgeId,
        label:
          zoom < 0.4
            ? ''
            : `${relationNames[e.relationType]}${e.status === 'pending' ? ' · 待审核' : e.status === 'review' ? ' · 需复核' : ''}`,
        style: {
          stroke: color,
          strokeWidth:
            e.id === lab.ui.selectedEdgeId ? 3.5 : e.strengthClass === 'strong' ? 2.8 : 1.4,
          strokeDasharray:
            e.strengthClass === 'weak'
              ? '5 5'
              : e.status === 'pending' && e.strengthClass === 'conflict'
                ? '7 4'
                : undefined,
          opacity: related ? (adjacent ? 0.95 : 0.45) : 0.14,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        labelStyle: { fontSize: 11, fill: color },
        labelBgStyle: { fill: '#fbfaf7', fillOpacity: 0.96 },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
        interactionWidth: 24,
        deletable: false,
        ariaLabel: `${relationNames[e.relationType]}：${e.rationale}`,
      };
    });
  const chainKey = chain ? [...chain].sort().join('|') : '';
  useEffect(() => {
    if (props.active === false) return;
    if (chain) {
      if (!originalViewport.current) originalViewport.current = flow.getViewport();
      const physical = graph.nodes.filter(
        (n) =>
          chain.has(n.id) ||
          (n.type === 'source' &&
            lab.nodes.some(
              (v) => chain.has(v.id) && v.sourceIds.some((id) => sourceNodeId(id) === n.id),
            )),
      );
      if (physical.length)
        void flow.fitView({
          nodes: physical.map((n) => ({ id: n.id })),
          padding: 0.12,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
          minZoom: 0.2,
          maxZoom: 0.9,
        });
    } else if (originalViewport.current) {
      void flow.setViewport(originalViewport.current, { duration: 0 });
      originalViewport.current = null;
    }
    // The viewport is an external canvas system. Layout/data changes must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, flow, props.active]);
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowBoardNode>[]) => {
      const dimensions = changes.filter((c) => c.type === 'dimensions' && c.dimensions);
      if (dimensions.length)
        setSizes((current) => {
          const next = { ...current };
          let changed = false;
          for (const c of dimensions)
            if (
              c.type === 'dimensions' &&
              c.dimensions &&
              (current[c.id]?.width !== c.dimensions.width ||
                current[c.id]?.height !== c.dimensions.height)
            ) {
              next[c.id] = c.dimensions;
              changed = true;
            }
          return changed ? next : current;
        });
      const moved = changes.filter((c) => c.type === 'position' && c.position);
      if (!moved.length) return;
      setPositions((current) => {
        const next = { ...current };
        for (const c of moved) if (c.type === 'position' && c.position) next[c.id] = c.position;
        return next;
      });
      for (const c of moved)
        if (c.type === 'position' && c.position && c.dragging === false && !dragging.current) {
          props.onMove(c.id, c.position);
          setPositions((current) => {
            const next = { ...current };
            delete next[c.id];
            return next;
          });
        }
    },
    [props],
  );
  function restore() {
    props.onRestoreFocus();
    if (!chain) fitAll();
  }
  return (
    <section
      ref={surface}
      className="lab-board"
      aria-label="交互式证据板"
      data-testid="evidence-board"
    >
      <ReactFlow<FlowBoardNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeComponents}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => {
          dragging.current = true;
        }}
        onNodeDragStop={(_, node) => {
          dragging.current = false;
          props.onMove(node.id, node.position);
          setPositions({});
        }}
        onNodeClick={(_, node) => props.onSelect(node.id)}
        onNodeDoubleClick={(_, node) => props.onOpen(node.id)}
        onEdgeClick={(_, edge) => props.onEdge(edge.id)}
        onPaneClick={() => props.onSelect(null)}
        onConnect={(connection: Connection) => {
          if (connection.source && connection.target)
            props.onConnect(connection.source, connection.target);
        }}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        onMoveEnd={(_, viewport) => {
          if (!focused.current && props.active !== false) viewportCommit.current(viewport);
        }}
        defaultViewport={lab.ui.viewport}
        minZoom={0.12}
        maxZoom={2.5}
        onlyRenderVisibleElements
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        preventScrolling
        deleteKeyCode={null}
        selectionOnDrag={false}
        nodesConnectable
        snapToGrid
        snapGrid={[10, 10]}
        connectionRadius={30}
        proOptions={{ hideAttribution: false }}
        ariaLabelConfig={{
          'node.a11yDescription.default': '按Enter选择节点，方向键移动；详情中可查看证据和操作。',
          'edge.a11yDescription.default': '按Enter选择关系，查看类型、依据和删除操作。',
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d2d1cb" />
        <MiniMap<FlowBoardNode>
          pannable
          zoomable
          nodeColor={(n) =>
            ({
              source: '#c7dcd4',
              evidence: '#d2e0ed',
              feature: '#d6d0e7',
              inference: '#efd9b7',
              question: '#edd0c9',
              role: '#c4d4e7',
              requirement: '#cfdecb',
            })[n.data.node.type]
          }
          position="bottom-right"
        />
      </ReactFlow>
      <div className="lab-board-controls" role="toolbar" aria-label="画布操作">
        <button
          aria-pressed={lab.ui.boardDensity === 'all'}
          onClick={() => props.onDensity(lab.ui.boardDensity === 'all' ? 'core' : 'all')}
        >
          {lab.ui.boardDensity === 'all' ? '只看核心线索' : '显示全部节点'}
        </button>
        <button aria-label="放大画布" onClick={() => void flow.zoomIn({ duration: 0 })}>
          <Plus size={16} />
        </button>
        <output aria-label="画布缩放比例">{Math.round(zoom * 100)}%</output>
        <button aria-label="缩小画布" onClick={() => void flow.zoomOut({ duration: 0 })}>
          <Minus size={16} />
        </button>
        <span />
        <button onClick={fitAll}>
          <Scan size={15} />
          适配全部
        </button>
        <button
          disabled={!lab.ui.selectedNodeId}
          onClick={() => {
            if (selectedPhysical)
              void flow.fitView({
                nodes: [{ id: selectedPhysical }],
                padding: 0.4,
                maxZoom: 1,
                duration: 0,
              });
          }}
        >
          <Focus size={15} />
          聚焦节点
        </button>
        <button onClick={restore}>
          <RotateCcw size={14} />
          {chain ? '显示全部' : '恢复完整视图'}
        </button>
        {props.onCompact && (
          <button
            onClick={() => {
              pendingCompactFit.current = true;
              if (!props.onCompact?.()) pendingCompactFit.current = false;
            }}
          >
            紧凑整理
          </button>
        )}
        <button aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>
          <Filter size={14} />
          筛选
        </button>
      </div>
      <div className="lab-board-legend">
        <span>
          <i className="strong" />
          直接依据
        </span>
        <span>
          <i className="weak" />
          弱关联 / 推导
        </span>
        <span>
          <i className="conflict" />
          冲突待核实
        </span>
        <small>
          {nodes.length}个可见节点 / {lab.nodes.length}个对象 · {edges.length}条可见关系
        </small>
      </div>
      <details className="lab-board-evidence-note">
        <summary>
          {images.length
            ? `图片证据：${readyImages.length}张已就绪，${images.length - readyImages.length}张待核对`
            : '部分解析资料如何参与关联？'}
        </summary>
        <p>
          已有定位、已核对的图像或关键帧证据可参与分析；仅预览的资料需先打开原始资料补充区域说明，或识图并接受标注，再启动关联分析。不会仅凭文件名自动连线。
        </p>
        <p>紧凑整理保留手动位置，可用顶部撤销恢复。</p>
        {props.onSource &&
          images
            .filter((s) => !readyImages.some((v) => v.id === s.id))
            .slice(0, 3)
            .map((s) => (
              <button key={s.id} onClick={() => props.onSource?.(s.id)}>
                识图 / 核对：{s.title}
              </button>
            ))}
      </details>
      {chain && (
        <div className="lab-focus-banner">
          <Network size={14} />
          {lab.ui.focusedRequirementId
            ? '正在聚焦岗位要求的证据链'
            : lab.ui.focusTarget?.kind === 'edge'
              ? '正在聚焦关系与双方依据'
              : '正在聚焦当前对象的证据链'}
          ；节点坐标保持不变。
          <button onClick={props.onRestoreFocus}>显示全部</button>
        </div>
      )}
      {filterOpen && (
        <div className="lab-filter-popover">
          <fieldset>
            <legend>节点类型</legend>
            {nodeTypes.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={!lab.ui.filters.types.length || lab.ui.filters.types.includes(type)}
                  onChange={(e) =>
                    props.onFilter(
                      e.target.checked
                        ? [...new Set([...lab.ui.filters.types, type])]
                        : nodeTypes.filter(
                            (t) =>
                              t !== type &&
                              (!lab.ui.filters.types.length || lab.ui.filters.types.includes(t)),
                          ),
                      lab.ui.filters.relations,
                      lab.ui.filters.status,
                    )
                  }
                />
                {nodeTypeNames[type]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>关系类型</legend>
            {relationTypes.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={
                    !lab.ui.filters.relations.length || lab.ui.filters.relations.includes(type)
                  }
                  onChange={(e) =>
                    props.onFilter(
                      lab.ui.filters.types,
                      e.target.checked
                        ? [...new Set([...lab.ui.filters.relations, type])]
                        : relationTypes.filter(
                            (t) =>
                              t !== type &&
                              (!lab.ui.filters.relations.length ||
                                lab.ui.filters.relations.includes(t)),
                          ),
                      lab.ui.filters.status,
                    )
                  }
                />
                {relationNames[type]}
              </label>
            ))}
          </fieldset>
          <label>
            确认状态
            <select
              aria-label="筛选图谱状态"
              value={lab.ui.filters.status}
              onChange={(e) =>
                props.onFilter(lab.ui.filters.types, lab.ui.filters.relations, e.target.value)
              }
            >
              {[
                ['all', '全部'],
                ['pending', '待审核'],
                ['confirmed', '已确认'],
                ['review', '需复核'],
                ['excluded', '已排除'],
                ['failed', '失败'],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => props.onFilter([], [], 'all')}>重置筛选</button>
        </div>
      )}
      {!nodes.length && (
        <div className="lab-board-empty">
          <Network size={38} />
          <h2>从一条线索开始</h2>
          <p>添加想法、链接或截图。资料会进入证据板，再按需关联分析。</p>
        </div>
      )}
    </section>
  );
}
export function BoardCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
