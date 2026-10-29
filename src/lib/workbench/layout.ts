export function fitColumns(
  width: number,
  layout: {
    leftWidth: number;
    rightWidth: number;
    leftOpen: boolean;
    rightOpen: boolean;
  },
) {
  const available = Math.max(
    460,
    width - (width > 1100 ? 420 : 340) - (Number(layout.leftOpen) + Number(layout.rightOpen)) * 10,
  );
  const leftMax = Math.min(440, available - (layout.rightOpen ? 260 : 0));
  const leftWidth = Math.round(Math.max(200, Math.min(leftMax, layout.leftWidth)));
  const rightMax = Math.min(520, available - (layout.leftOpen ? leftWidth : 0));
  const rightWidth = Math.round(Math.max(260, Math.min(rightMax, layout.rightWidth)));
  return {
    leftWidth,
    rightWidth,
    leftBounds: { min: 200, max: Math.min(440, available - (layout.rightOpen ? rightWidth : 0)) },
    rightBounds: { min: 260, max: Math.min(520, available - (layout.leftOpen ? leftWidth : 0)) },
  };
}
