export function TextDiff({ before, after }: { before: string; after: string }) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const prefix = before.slice(0, start);
  const suffix = end ? before.slice(-end) : '';
  const oldPart = before.slice(start, end ? before.length - end : before.length);
  const newPart = after.slice(start, end ? after.length - end : after.length);
  return (
    <div className="diff-grid">
      <div className="diff-before">
        <span className="diff-label">修改前 · 删除标记</span>
        <div>
          {prefix}
          <del>{oldPart || '（无删除）'}</del>
          {suffix}
        </div>
      </div>
      <div className="diff-after">
        <span className="diff-label">修改后 · 新增标记</span>
        <div>
          {prefix}
          <ins>{newPart || '（无新增）'}</ins>
          {suffix}
        </div>
      </div>
    </div>
  );
}
