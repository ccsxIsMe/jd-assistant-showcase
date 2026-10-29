import { describe, it, expect, vi, afterEach } from 'vitest';
import { syntheticLab } from '../fixtures/lab';
import {
  createSnapshot,
  createSource,
  paragraphs,
  textEvidence,
} from '../../src/lib/exploration/domain';
import { materialFromSnapshot } from '../../src/lib/exploration/material';
import {
  importRequirementMaterial,
  upstreamPlan,
} from '../../src/lib/exploration/workbench-import';
import { newWorkspace, workspaceSchema } from '../../src/lib/workbench/model';
import { reviseSource } from '../../src/lib/workbench/domain';
import {
  compactBoard,
  moveNode,
  addAnnotation,
  updateAnnotation,
} from '../../src/lib/lab/operations';
import { synchronizeLab, visibleGraph, assertLab } from '../../src/lib/lab/graph';
import { buildLabRequest } from '../../src/lib/lab/workflow';
import { undoResearch } from '../../src/lib/exploration/journal';
import { prepareSourceImage } from '../../src/lib/workbench/images';

function roleOnlyMaterial() {
  const p = syntheticLab(20);
  const s = p.lab!.solutions[0];
  s.status = 'confirmed';
  p.lab!.activeSolutionIds = [s.id];
  p.lab!.requirements = [p.lab!.requirements[0]];
  Object.assign(p.lab!.requirements[0], { status: 'confirmed', relatedFeatureIds: [] });
  const snapshot = createSnapshot(synchronizeLab(p), 'draft', new Set());
  return materialFromSnapshot(snapshot);
}
afterEach(() => vi.unstubAllGlobals());
describe('岗位交接、图像和紧凑布局回归', () => {
  it('无产品功能关联的已确认要求可导入，不编造功能且保留来源、待确认边界', () => {
    const m = roleOnlyMaterial();
    const before = structuredClone(m);
    const w = importRequirementMaterial(newWorkspace('资料支撑的岗位'), m, [], true);
    expect(workspaceSchema.safeParse(w).success).toBe(true);
    expect(w.items.map((i) => i.kind).sort()).toEqual(['requirement', 'task']);
    expect(
      w.items.every((i) => i.status === 'pending' && i.researchLink?.featureIds.length === 0),
    ).toBe(true);
    expect(w.sources[0].snapshotOrigin?.snapshotId).toBe(m.snapshotId);
    expect(
      w.items.every(
        (i) => i.researchLink?.roleOrigin?.requirementId === m.roleData!.requirements[0].id,
      ),
    ).toBe(true);
    expect(m).toEqual(before);
    expect(
      upstreamPlan(w, w.researchImports![0], m).entries.every(
        (e) => e.itemId === null && e.kind === 'added' && !!e.featureId,
      ),
    ).toBe(true);
  });
  it('未确认要求、无效功能ID和无任何交付项仍然拒绝', () => {
    const m = roleOnlyMaterial();
    m.roleData!.requirements[0].status = 'pending';
    expect(() => importRequirementMaterial(newWorkspace('测试岗位'), m, [], true)).toThrow(
      /人工确认/,
    );
    expect(() =>
      importRequirementMaterial(newWorkspace('测试岗位'), roleOnlyMaterial(), ['missing'], true),
    ).toThrow(/有效的产品功能/);
    const empty = roleOnlyMaterial();
    delete empty.roleData;
    expect(() => importRequirementMaterial(newWorkspace('测试岗位'), empty, [], true)).toThrow(
      /有效的产品功能/,
    );
    const unsupported = roleOnlyMaterial();
    unsupported.roleData!.requirements[0].evidenceIds = [];
    expect(() =>
      importRequirementMaterial(newWorkspace('测试岗位'), unsupported, [], true),
    ).toThrow(/缺少可追溯依据/);
  });
  it('保留旧结构中的非feature依据，不将约束当作产品功能', () => {
    const m = roleOnlyMaterial();
    const condition = m.structureNodes!.find((f) => f.kind === 'feature')!;
    condition.kind = 'condition';
    m.features = m.features.filter((f) => f.id !== condition.id);
    m.assumptions = m.assumptions.map((f) =>
      f.id === condition.id ? structuredClone(condition) : f,
    );
    m.roleData!.requirements[0].relatedFeatureIds = [condition.id];
    const w = importRequirementMaterial(newWorkspace('测试岗位'), m, [], true);
    expect(w.items[0].researchLink!.featureIds).toEqual([]);
    expect(w.researchImports![0].material.roleData!.requirements[0].relatedFeatureIds).toEqual([
      condition.id,
    ]);
  });
  it('图片不是仅因partial被排除：核对前不送候选证据，核对后进入跨资料请求', () => {
    let p = syntheticLab(20);
    const image = createSource('image', '原始截图');
    image.status = 'partial';
    Object.assign(image.versions[0], {
      assetId: 'image-1',
      width: 100,
      height: 100,
      mime: 'image/png',
    });
    p.sources.push(image);
    p = addAnnotation(synchronizeLab(p), {
      sourceId: image.id,
      sourceRevision: 1,
      assetId: 'image-1',
      shapeType: 'rectangle',
      normalizedGeometry: { x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
      label: '截图有文件导出入口',
      status: 'pending',
      createdBy: 'ai',
      originalWidth: 100,
      originalHeight: 100,
    });
    const a = p.lab!.annotations[0];
    expect(
      buildLabRequest(p, 'link_evidence').analysis.evidence.some(
        (e) => e.evidenceId === a.evidenceId,
      ),
    ).toBe(false);
    p = updateAnnotation(p, a.id, { status: 'accepted' });
    const request = buildLabRequest(p, 'link_evidence');
    expect(request.analysis.evidence.find((e) => e.evidenceId === a.evidenceId)?.excerpt).toContain(
      '导出',
    );
    expect(request.analysis.sources.find((s) => s.id === image.id)?.status).toBe('partial');
  });
  it.each([20, 100, 300] as const)(
    '%i节点紧凑整理保持语义与手动位置，可撤销；新增不重排',
    (size) => {
      let p = syntheticLab(size);
      p = moveNode(p, p.lab!.nodes[0].id, { x: 60, y: 60 });
      // Reproduce an existing sparse saved layout.
      for (const [i, n] of p.lab!.nodes.entries())
        if (!n.userPositioned)
          n.layoutPosition = { x: (i % 8) * 1300, y: Math.floor(i / 8) * 1000 };
      const original = structuredClone(p);
      const next = compactBoard(p);
      expect(() => assertLab(next)).not.toThrow();
      expect(next.lab!.edges).toEqual(p.lab!.edges);
      expect(next.lab!.nodes[0].layoutPosition).toEqual({ x: 60, y: 60 });
      const visible = visibleGraph(next.lab!).nodes;
      for (let i = 0; i < visible.length; i++)
        for (let j = i + 1; j < visible.length; j++)
          expect(
            Math.abs(visible[i].layoutPosition.x - visible[j].layoutPosition.x) >= 325 ||
              Math.abs(visible[i].layoutPosition.y - visible[j].layoutPosition.y) >= 380,
          ).toBe(true);
      const area = (nodes: typeof visible) =>
        (Math.max(...nodes.map((n) => n.layoutPosition.x)) + 285) *
        (Math.max(...nodes.map((n) => n.layoutPosition.y)) + 320);
      expect(area(visible)).toBeLessThan(area(visibleGraph(p.lab!).nodes));
      const undone = synchronizeLab(undoResearch(next, next.operations!.at(-1)!.id));
      expect(undone.lab!.nodes.map((n) => n.layoutPosition)).toEqual(
        original.lab!.nodes.map((n) => n.layoutPosition),
      );
      const source = createSource('text', '新增资料');
      source.status = 'ready';
      source.versions[0].text = '新增与布局相关的资料';
      source.versions[0].paragraphs = paragraphs(source.versions[0].text);
      next.sources.push(source);
      next.evidence.push(...textEvidence(source, source.versions[0]));
      const added = synchronizeLab(next);
      for (const n of visible)
        expect(added.lab!.nodes.find((v) => v.id === n.id)!.layoutPosition).toEqual(
          n.layoutPosition,
        );
    },
  );
  it('图像大小、类型、签名与像素限制实际生效，说明修订保留原图版本', async () => {
    await expect(
      prepareSourceImage(new File(['svg'], 'bad.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow(/仅支持/);
    await expect(
      prepareSourceImage(
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow(/8MB/);
    await expect(
      prepareSourceImage(new File(['not png'], 'fake.png', { type: 'image/png' })),
    ).rejects.toThrow(/签名/);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 6000, height: 6000, close: vi.fn() }),
    );
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
    await expect(prepareSourceImage(png)).rejects.toThrow(/像素/);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 80, close: vi.fn() }),
    );
    const image = await prepareSourceImage(png);
    const w = newWorkspace('测试岗位');
    w.sources.push({
      id: 's',
      title: '截图',
      type: 'file',
      person: '用户粘贴',
      createdAt: 'test',
      removed: false,
      versions: [{ revision: 1, text: '人工图片说明', createdAt: 'test', image }],
    });
    const next = reviseSource(w, 's', '新版人工说明');
    expect(next.sources[0].versions[0].text).toBe('人工图片说明');
    expect(next.sources[0].versions[1].image).toEqual(image);
  });
});
