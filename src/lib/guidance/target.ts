// DOM visibility is stricter than getClientRects: closed <details> may keep layout boxes.
export function tutorialTargetVisible(element: HTMLElement) {
  if (
    !element.isConnected ||
    element.closest('[hidden],[aria-hidden="true"],.interactive-guide-layer')
  )
    return false;
  for (let p: HTMLElement | null = element; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (
      s.display === 'none' ||
      s.visibility === 'hidden' ||
      s.visibility === 'collapse' ||
      Number(s.opacity) === 0
    )
      return false;
    if (p instanceof HTMLDetailsElement && !p.open) {
      const summary = p.querySelector(':scope > summary');
      if (!summary?.contains(element)) return false;
    }
  }
  const r = element.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}
export function revealTutorialAncestors(element: HTMLElement) {
  if (element.closest('[hidden]')) return;
  for (let p = element.parentElement; p; p = p.parentElement)
    if (p instanceof HTMLDetailsElement) p.open = true;
}
export function tutorialVisibleBox(element: HTMLElement) {
  if (!tutorialTargetVisible(element)) return null;
  const r = element.getBoundingClientRect();
  let left = Math.max(0, r.left),
    top = Math.max(0, r.top),
    right = Math.min(innerWidth, r.right),
    bottom = Math.min(innerHeight, r.bottom);
  for (let p = element.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p),
      b = p.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(s.overflowX)) {
      left = Math.max(left, b.left);
      right = Math.min(right, b.right);
    }
    if (/auto|scroll|hidden|clip/.test(s.overflowY)) {
      top = Math.max(top, b.top);
      bottom = Math.min(bottom, b.bottom);
    }
  }
  return right - left > 2 && bottom - top > 2
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}
