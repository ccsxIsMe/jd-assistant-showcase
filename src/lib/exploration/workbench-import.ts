import { fields, newItem, now, uid, type Source, type Workspace } from '../workbench/model';
import { log, touch, editItem } from '../workbench/domain';
import { validateMaterial, materialFeatureEvidenceState } from './material';
import type { RequirementMaterial, ResearchImport } from './material-model';
import type { Finding } from './model';
import { evidenceValid } from './domain';
export function roleDiscussion(m: RequirementMaterial) {
  const text = m.features.map((f) => `${f.title} ${f.description} ${f.behavior}`).join('\n');
  const roles = [
    {
      title: '岗位分工与团队现有能力待确认',
      detail:
        '先确认本岗位承担哪些功能、哪些由已有成员或外部服务提供，再结合预算和阶段选择岗位；不能从截图直接推定人数。',
    },
  ];
  if (/界面|前端|预览|交互|页面|编辑/.test(text))
    roles.push({
      title: '界面交付角色（候选方向）',
      detail: '可讨论前端界面实现与交互调试职责；具体框架、承担范围及是否需要新增岗位均待确认。',
    });
  if (/登录|协作|数据库|接口|数据服务|权限/.test(text))
    roles.push({
      title: '服务端与集成角色（条件性候选）',
      detail:
        '仅在相关数据、权限或协作服务不能复用时讨论后端/集成职责；不能据此确定必需招聘后端或全栈。',
    });
  return roles;
}
function skillDiscussion(f: Finding) {
  const text = `${f.title} ${f.description} ${f.behavior}`;
  if (/导出|文件格式/.test(text))
    return '文件导出链路、格式兼容与验收相关实践（格式、边界及承担角色待确认）';
  if (/协作|同步/.test(text))
    return '多人协作、一致性与权限边界相关实践（是否需要、本岗位是否承担待确认）';
  if (/登录|认证|权限/.test(text)) return '身份与访问控制相关实践（优先澄清现有体系能否复用）';
  if (/页面|界面|编辑|预览|交互/.test(text))
    return '界面实现、交互调试与可用性验收相关实践（具体技术栈待确认）';
  return '需求澄清、交付验证与团队协作相关能力（具体技能和岗位边界待讨论）';
}
export function sourceForFeature(m: RequirementMaterial, feature: Finding): Source {
  const text = `${m.mode === 'example' ? '演示数据，非真实AI分析' : '产品需求研究资料，仍需人工核实'}\n快照：${m.snapshotId} / V${m.snapshotVersion}\n产品目标：${m.objective || '待补充'}\n功能：${feature.title}\n需求：${feature.description}\n用户行为：${feature.behavior}\n预期结果：${feature.outcome}\n来源结论状态：${feature.status}；依据：${feature.basis}\n不确定性：${feature.uncertainty || '岗位分工、预算和具体实施方案待确认'}\n约束：${m.constraints.join('\n').slice(0, 12000) || '待补充'}\n证据：${feature.evidenceIds.join(', ')}\n以上功能不是一个岗位必须独立承担的全部职责，导入候选全部待讨论。`;
  return {
    id: uid(),
    title: `${m.title.slice(0, 110)} · V${m.snapshotVersion} · ${feature.title.slice(0, 60)}`,
    type: 'project',
    person: '用户主动导入的研究资料；程序形成讨论候选，未授予岗位确认',
    createdAt: now(),
    removed: false,
    versions: [{ revision: 1, text, createdAt: now() }],
    snapshotOrigin: {
      snapshotId: m.snapshotId,
      explorationId: m.explorationId,
      version: m.snapshotVersion,
      mode: m.mode,
      title: m.title,
      createdAt: m.createdAt,
      evidenceIds: feature.evidenceIds,
      sources: m.sourceManifest.map((s) => ({
        id: s.sourceId,
        title: s.title,
        revision: s.revision,
        url: s.url,
      })),
    },
  };
}
function taskForFeature(
  m: RequirementMaterial,
  feature: Finding,
  source: Source,
  importId: string,
) {
  const task = newItem(
    'task',
    feature.title,
    `需求讨论：${feature.description}\n用户行为：${feature.behavior || '待补充'}\n预期交付：${feature.outcome || '待确认验收标准'}\n讨论候选：本岗位是否承担、与现有团队如何分工，需结合阶段和预算确认。`,
  );
  task.scope = '来自产品功能的待讨论交付候选；职责边界、岗位角色和技术方案均未据此确定。';
  task.priority = feature.priority;
  task.refs = [
    {
      sourceId: source.id,
      sourceRevision: 1,
      excerpt: source.versions[0].text.slice(0, 2500),
      start: 0,
      verified: true,
    },
  ];
  task.researchLink = {
    importId,
    snapshotId: m.snapshotId,
    version: m.snapshotVersion,
    featureIds: [feature.id],
    evidenceIds: feature.evidenceIds,
    sourceStatus: feature.status,
    importedFields: fields(task),
  };
  return task;
}
/** 研究确认与岗位确认分开：保留来源快照/证据链，导入条目重新进入岗位待确认流程。 */
export function importRequirementMaterial(
  workspace: Workspace,
  raw: unknown,
  selectedFeatureIds: string[],
  allowUnconfirmed = false,
) {
  const m = validateMaterial(raw);
  const selected = [...new Set(selectedFeatureIds)];
  const roleRequirements =
    m.roleData?.requirements.filter((r) =>
      m.roleData!.selectedSolutionIds.includes(r.solutionId),
    ) ?? [];
  if (
    (!selected.length && !roleRequirements.length) ||
    selected.some((id) => !m.features.some((f) => f.id === id))
  )
    throw new Error('请选择有效的产品功能。');
  if (
    m.features.some(
      (f) =>
        selected.includes(f.id) &&
        (f.status !== 'confirmed' || materialFeatureEvidenceState(m, f.id) !== 'current'),
    ) &&
    !allowUnconfirmed
  )
    throw new Error('所选功能尚未确认或证据需复核，请明确确认导入为待讨论候选。');
  if (workspace.researchImports?.some((r) => r.snapshotId === m.snapshotId))
    throw new Error('该版本已导入，请使用检查上游更新。');
  const w = structuredClone(workspace);
  if (m.demo && !workspace.items.length && !workspace.sources.length) w.demo = m.demo;
  const importId = uid();
  for (const f of m.features.filter((f) => selected.includes(f.id))) {
    const source = sourceForFeature(m, f);
    const task = taskForFeature(m, f, source, importId);
    const requirement = newItem(
      'requirement',
      skillDiscussion(f).slice(0, 160),
      '初步技能讨论建议，来自所选功能的交付情境，不是已确认的必备条件。请先核实岗位分工、现有团队、预算及实际技术方案；不自动写入JD。',
    );
    requirement.refs = structuredClone(task.refs);
    requirement.taskIds = [task.id];
    requirement.researchLink = {
      ...structuredClone(task.researchLink!),
      importedFields: fields(requirement),
    };
    task.requirementIds = [requirement.id];
    w.sources.push(source);
    w.items.push(task, requirement);
  }
  if (w.sources.length > 100 || w.items.length > 500)
    throw new Error('导入后岗位资料或条目超过限制，请减少所选功能。');
  w.researchImports = [
    ...(w.researchImports ?? []),
    {
      id: importId,
      snapshotId: m.snapshotId,
      lineageRootId: m.lineageRootId,
      explorationId: m.explorationId,
      importedAt: now(),
      material: m,
      versions: [m],
    },
  ];
  for (const role of m.roleData ? [] : roleDiscussion(m))
    w.questions.push({
      id: uid(),
      title: role.title,
      detail: `${role.detail}\n来源研究：${m.title} V${m.snapshotVersion}；候选不是招聘结论。`,
      kind: 'human',
      important: true,
      targetIds: w.items
        .filter((i) => i.researchLink?.importId === importId && i.kind === 'task')
        .map((i) => i.id),
      refs: [],
      status: 'open',
      answer: '',
      reason: '',
      createdAt: now(),
    });
  function inheritQuestions() {
    for (const question of currentDecisions(m.openQuestions))
      w.questions.push({
        id: uid(),
        title: `产品需求待确认：${question.title}`,
        detail: `${question.detail}\n产品研究中的回答：${question.answer || '尚未回答'}；请先核实，再决定岗位职责。`,
        kind: 'human',
        important: true,
        targetIds: w.items
          .filter(
            (i) =>
              i.kind === 'task' &&
              i.researchLink?.importId === importId &&
              (!question.findingIds.length ||
                i.researchLink.featureIds.some((id) => question.findingIds.includes(id)) ||
                m.roleData?.requirements.some(
                  (r) =>
                    r.id === i.researchLink?.roleOrigin?.requirementId &&
                    [...r.relatedFeatureIds, ...r.inferenceIds].some((id) =>
                      question.findingIds.includes(id),
                    ),
                )),
          )
          .map((i) => i.id),
        refs: [],
        status:
          question.status === 'deferred'
            ? 'deferred'
            : question.status === 'excluded'
              ? 'ignored'
              : 'open',
        answer: question.answer,
        choices: question.choices,
        decisionSpec: question.decisionSpec,
        response: question.response,
        decision: {
          ...initializeDecision(question).decision!,
          answerNeedsReview: !!question.answer,
          inheritedFrom: {
            projectId: m.explorationId,
            snapshotId: m.snapshotId,
            questionId: question.id,
          },
        },
        reason: '',
        createdAt: now(),
      });
    for (const q of w.questions.filter(
      (q) => q.decision?.inheritedFrom?.snapshotId === m.snapshotId,
    ))
      if (q.decisionSpec?.scope)
        q.decisionSpec = {
          ...q.decisionSpec,
          scope: { ...q.decisionSpec.scope, perspective: 'role', objectIds: [...q.targetIds] },
        };
  }
  w.ui.view = 'tasks';
  if (m.roleData) {
    const d = m.roleData;
    const solutions = d.solutions.filter((s) => d.selectedSolutionIds.includes(s.id));
    if (!solutions.length || solutions.some((s) => s.status !== 'confirmed'))
      throw new Error('请先确认并选择候选岗位方案。');
    const requirements = d.requirements.filter((r) => solutions.some((s) => s.id === r.solutionId));
    if (
      requirements.some((r) =>
        r.evidenceIds.some(
          (id) =>
            !m.evidenceRecords.some(
              (e) => e.evidenceId === id && evidenceValid({ sources: m.sourceRecords }, e),
            ),
        ),
      )
    )
      throw new Error('岗位要求引用过期或未核对证据，请回到来源复核。');
    if (!requirements.length || requirements.some((r) => r.status !== 'confirmed'))
      throw new Error('只允许导入已人工确认的所选岗位要求。');
    if (
      requirements.some(
        (r) => !r.relatedFeatureIds.length && !r.inferenceIds.length && !r.evidenceIds.length,
      )
    )
      throw new Error('岗位要求缺少可追溯依据，请先补充来源或关联推断。');
    const generic = new Set(
      w.items
        .filter((i) => i.kind === 'requirement' && i.researchLink?.importId === importId)
        .map((i) => i.id),
    );
    w.items = w.items.filter((i) => !generic.has(i.id));
    for (const i of w.items) i.requirementIds = i.requirementIds.filter((id) => !generic.has(id));
    for (const r of requirements) {
      const tasks = w.items.filter(
        (i) =>
          i.kind === 'task' &&
          i.researchLink?.importId === importId &&
          i.researchLink.featureIds.some((id) => r.relatedFeatureIds.includes(id)),
      );
      if (!tasks.length) {
        // A requirement may legitimately be supported by evidence/inferences only.
        // Keep it a role deliverable; never fabricate a product feature to satisfy import.
        const source: Source = {
          id: uid(),
          title: `${m.title.slice(0, 90)} · 岗位交付依据 · ${r.title.slice(0, 60)}`,
          type: 'project',
          person: '用户确认的研究岗位要求；导入后仍待岗位复核',
          createdAt: now(),
          removed: false,
          versions: [
            {
              revision: 1,
              createdAt: now(),
              text: [
                m.modeNotice,
                `来源快照：${m.snapshotId} / V${m.snapshotVersion}`,
                `候选岗位交付：${r.title}`,
                r.description,
                `方案依据：${r.rationale}`,
                `待核实：${r.uncertainty}`,
                `关联推断：${r.inferenceIds.join('、') || '无'}`,
                `证据：${r.evidenceIds.join('、') || '暂无直接证据，仍需核实'}`,
                '此项来自岗位要求，不代表产品功能事实；导入后等待人工确认职责边界。',
              ]
                .join('\n')
                .slice(0, 30000),
            },
          ],
          snapshotOrigin: {
            snapshotId: m.snapshotId,
            explorationId: m.explorationId,
            version: m.snapshotVersion,
            mode: m.mode,
            title: m.title,
            createdAt: m.createdAt,
            evidenceIds: r.evidenceIds,
            sources: m.sourceManifest.map((s) => ({
              id: s.sourceId,
              title: s.title,
              revision: s.revision,
              url: s.url,
            })),
          },
        };
        const task = newItem('task', `岗位交付：${r.title}`.slice(0, 300), r.description);
        task.scope = '由已确认研究要求带入的岗位交付候选，职责与验收边界待确认；不是新增产品功能。';
        task.refs = [
          {
            sourceId: source.id,
            sourceRevision: 1,
            excerpt: source.versions[0].text.slice(0, 2500),
            start: 0,
            verified: true,
          },
        ];
        task.researchLink = {
          importId,
          snapshotId: m.snapshotId,
          version: m.snapshotVersion,
          featureIds: [],
          evidenceIds: r.evidenceIds,
          sourceStatus: 'confirmed',
          roleOrigin: { solutionId: r.solutionId, requirementId: r.id, roleKey: r.roleKey },
          importedFields: fields(task),
        };
        w.sources.push(source);
        w.items.push(task);
        tasks.push(task);
      }
      const item = newItem(
        'requirement',
        r.title,
        r.description + '\n岗位方案依据：' + r.rationale + '\n待核实条件：' + r.uncertainty,
      );
      item.category =
        r.requirementType === 'trainable'
          ? 'train'
          : r.requirementType === 'pending'
            ? 'unknown'
            : r.requirementType;
      item.taskIds = tasks.map((t) => t.id);
      item.refs = structuredClone(tasks.flatMap((t) => t.refs)).slice(0, 30);
      item.researchLink = {
        ...structuredClone(tasks[0].researchLink!),
        featureIds: tasks.flatMap((t) => t.researchLink!.featureIds),
        evidenceIds: r.evidenceIds,
        sourceStatus: 'confirmed',
        roleOrigin: { solutionId: r.solutionId, requirementId: r.id, roleKey: r.roleKey },
        importedFields: fields(item),
      };
      for (const t of tasks) t.requirementIds.push(item.id);
      w.items.push(item);
    }
    if (w.items.length > 500 || w.sources.length > 100)
      throw new Error('导入后资料或条目超过限制，请减少选择。');
  }
  inheritQuestions();
  w.ui.selectedId = w.items.find((i) => i.researchLink?.importId === importId)?.id ?? null;
  log(
    w,
    `用户明确导入研究快照V${m.snapshotVersion}：${selected.length}项任务及技能讨论候选全部待确认`,
  );
  return touch(w);
}
export type UpstreamEntry = {
  featureId: string;
  itemId: string | null;
  revision: number;
  kind: 'added' | 'changed' | 'removed';
  locked: boolean;
  locallyEdited: boolean;
  before: string;
  after: string;
  roleRequirementId?: string;
};
/** 只计算同谱系上游差异，标明本地编辑和锁定状态，不在比较时修改岗位正文。 */
export function upstreamPlan(w: Workspace, record: ResearchImport, latest: RequirementMaterial) {
  validateMaterial(latest);
  if (latest.lineageRootId !== record.lineageRootId) throw new Error('上游研究谱系不匹配。');
  const versions = [record.material, ...(record.versions ?? [])];
  const entries: UpstreamEntry[] = [];
  const tasks = w.items.filter((i) => i.kind === 'task' && i.researchLink?.importId === record.id);
  for (const task of tasks) {
    const link = task.researchLink!;
    if (!link.featureIds.length && link.roleOrigin) continue;
    const previous = versions
      .find((v) => v.snapshotId === link.snapshotId)
      ?.features.find((f) => link.featureIds.includes(f.id));
    const next = latest.features.find((f) => link.featureIds.includes(f.id));
    if (!next || !previous || JSON.stringify(previous) !== JSON.stringify(next))
      entries.push({
        featureId: link.featureIds[0],
        itemId: task.id,
        revision: task.revision,
        kind: next ? 'changed' : 'removed',
        locked: task.locked,
        locallyEdited: JSON.stringify(fields(task)) !== JSON.stringify(link.importedFields),
        before: previous?.description ?? task.text,
        after: next?.description ?? '上游功能已移除或排除。保留本地正文，关联条目需要复核。',
      });
  }
  for (const f of latest.features)
    if (!tasks.some((task) => task.researchLink!.featureIds.includes(f.id)))
      entries.push({
        featureId: f.id,
        itemId: null,
        revision: 0,
        kind: 'added',
        locked: false,
        locallyEdited: false,
        before: '',
        after: f.description,
      });
  for (const item of w.items.filter(
    (i) =>
      i.kind === 'requirement' &&
      i.researchLink?.importId === record.id &&
      i.researchLink.roleOrigin,
  )) {
    const link = item.researchLink!,
      id = link.roleOrigin!.requirementId;
    const previous = versions
      .find((m) => m.snapshotId === link.snapshotId)
      ?.roleData?.requirements.find((r) => r.id === id);
    const next = latest.roleData?.requirements.find((r) => r.id === id && r.status !== 'excluded');
    if (!previous || !next || JSON.stringify(previous) !== JSON.stringify(next))
      entries.push({
        featureId: `role:${id}`,
        roleRequirementId: id,
        itemId: item.id,
        revision: item.revision,
        kind: next ? 'changed' : 'removed',
        locked: item.locked,
        locallyEdited: JSON.stringify(fields(item)) !== JSON.stringify(link.importedFields),
        before: previous?.description ?? item.text,
        after: next?.description ?? '上游岗位要求被移除或排除，正文保留并需复核。',
      });
  }
  return {
    importId: record.id,
    latestSnapshotId: latest.snapshotId,
    entries,
    constraintsChanged:
      JSON.stringify(record.material.constraints) !== JSON.stringify(latest.constraints),
  };
}
/** 用户选取同步范围后重新核对计划与目标版本，未选正文及本地锁定不能被静默覆盖。 */
export function applyUpstreamPlan(
  workspace: Workspace,
  importId: string,
  raw: unknown,
  plan: ReturnType<typeof upstreamPlan>,
  selectedFeatureIds: string[],
) {
  const latest = validateMaterial(raw);
  const record = workspace.researchImports?.find((r) => r.id === importId);
  if (!record || plan.importId !== importId || plan.latestSnapshotId !== latest.snapshotId)
    throw new Error('更新计划不匹配。');
  const verified = upstreamPlan(workspace, record, latest);
  if (selectedFeatureIds.some((id) => !plan.entries.some((entry) => entry.featureId === id)))
    throw new Error('更新范围不合法。');
  if (
    plan.entries.some(
      (entry) =>
        !verified.entries.some(
          (v) =>
            v.itemId === entry.itemId &&
            v.featureId === entry.featureId &&
            v.kind === entry.kind &&
            v.revision === entry.revision,
        ),
    )
  )
    throw new Error('更新计划已过期或目标不属于本次研究导入。');
  let w = structuredClone(workspace);
  const selected = new Set(selectedFeatureIds);
  for (const entry of plan.entries.filter((e) => selected.has(e.featureId))) {
    const old = entry.itemId ? w.items.find((i) => i.id === entry.itemId) : null;
    if (entry.itemId && (!old || old.revision !== entry.revision))
      throw new Error('本地已有新编辑，更新计划过期；没有覆盖数据。');
    if (entry.roleRequirementId) {
      if (!old) throw new Error('岗位要求已不存在。');
      const next = latest.roleData?.requirements.find((r) => r.id === entry.roleRequirementId);
      if (entry.kind === 'removed' || !next || next.status !== 'confirmed') {
        old.status = 'review';
        old.revision++;
        log(w, '上游岗位要求失效或待确认，保留原文并标记复核');
        continue;
      }
      if (old.locked) throw new Error('锁定要求不能同步正文。');
      w = editItem(w, old.id, {
        title: next.title,
        text:
          next.description +
          '\n岗位方案依据：' +
          next.rationale +
          '\n待核实条件：' +
          next.uncertainty,
        category:
          next.requirementType === 'trainable'
            ? 'train'
            : next.requirementType === 'pending'
              ? 'unknown'
              : next.requirementType,
      });
      const updated = w.items.find((i) => i.id === old.id)!;
      updated.researchLink = {
        ...updated.researchLink!,
        snapshotId: latest.snapshotId,
        version: latest.snapshotVersion,
        evidenceIds: next.evidenceIds,
        importedFields: fields(updated),
      };
      const operationItem = w.operations[0]?.after.find((i) => i.id === old.id);
      if (operationItem) operationItem.researchLink = structuredClone(updated.researchLink);
      continue;
    }
    if (entry.kind === 'removed') {
      const ids = new Set(
        w.items
          .filter(
            (i) =>
              i.researchLink?.importId === importId &&
              i.researchLink.featureIds.includes(entry.featureId),
          )
          .map((i) => i.id),
      );
      let found = true;
      while (found) {
        found = false;
        for (const i of w.items)
          if (!ids.has(i.id) && [...i.taskIds, ...i.requirementIds].some((id) => ids.has(id))) {
            ids.add(i.id);
            found = true;
          }
      }
      for (const i of w.items.filter((i) => ids.has(i.id) && i.status !== 'excluded')) {
        i.status = 'review';
        i.revision++;
      }
      log(w, '上游功能移除，既有任务、岗位要求和关联JD保留，仅标记需复核');
      continue;
    }
    if (old?.locked) throw new Error('锁定条目不能同步正文。');
    const f = latest.features.find((f) => f.id === entry.featureId);
    if (!f) throw new Error('上游功能不存在。');
    const source = sourceForFeature(latest, f);
    const candidate = taskForFeature(latest, f, source, importId);
    w.sources.push(source);
    if (!old) w.items.push(candidate);
    else {
      w = editItem(w, old.id, {
        title: candidate.title,
        text: candidate.text,
        scope: candidate.scope,
        refs: candidate.refs,
      });
      const updated = w.items.find((i) => i.id === old.id)!;
      updated.researchLink = { ...candidate.researchLink!, importedFields: fields(updated) };
      const operationItem = w.operations[0]?.after.find((i) => i.id === old.id);
      if (operationItem) operationItem.researchLink = structuredClone(updated.researchLink);
    }
  }
  if (w.sources.length > 100 || w.items.length > 500)
    throw new Error('更新超过岗位资料或条目数量上限。');
  const current = w.researchImports!.find((r) => r.id === importId)!;
  current.versions = [
    ...new Map(
      [...(current.versions ?? [current.material]), latest].map((v) => [v.snapshotId, v]),
    ).values(),
  ];
  if (current.versions.length > 20)
    throw new Error('该导入链已保存20个版本，请创建新的研究导入记录。');
  if (plan.constraintsChanged) {
    w.questions.push({
      id: uid(),
      title: '上游产品约束已有新版本，需要核实岗位影响',
      detail: `原约束：${record.material.constraints.join('；') || '未明确'}\n新约束：${latest.constraints.join('；') || '未明确'}\n未自动修改岗位职责或要求。`,
      kind: 'dependency',
      important: true,
      targetIds: w.items.filter((i) => i.researchLink?.importId === importId).map((i) => i.id),
      refs: [],
      status: 'open',
      answer: '',
      reason: '',
      createdAt: now(),
    });
  }
  current.material = latest;
  current.snapshotId = latest.snapshotId;
  log(w, `用户选择同步研究快照V${latest.snapshotVersion}中的${selected.size}项变更；未选正文保留`);
  return touch(w);
}
import { currentDecisions } from '../decisions/records';
import { initializeDecision } from '../decisions/quality';
