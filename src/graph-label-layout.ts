export type ScreenPoint = { x: number; y: number };
export type ScreenBox = ScreenPoint & { width: number; height: number };
export type ScreenSegment = readonly [ScreenPoint, ScreenPoint];

const clearance = 4;
const shifts = [0, -8, 8, -16, 16, -24, 24, -32, 32, -48, 48];
const offsets = shifts.flatMap(y => shifts.map(x => ({ x, y })))
  .sort((a, b) => a.x ** 2 + a.y ** 2 - b.x ** 2 - b.y ** 2);

function intersectsBox(box: ScreenBox, [a, b]: ScreenSegment): boolean {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  if (Math.max(a.x, b.x) < box.x || Math.min(a.x, b.x) > right
    || Math.max(a.y, b.y) < box.y || Math.min(a.y, b.y) > bottom) return false;

  // The segment's supporting line is the last possible separating axis.
  const side = (x: number, y: number) => (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
  const corners = [side(box.x, box.y), side(right, box.y), side(box.x, bottom), side(right, bottom)];
  return Math.min(...corners) <= 0 && Math.max(...corners) >= 0;
}

export function findGraphLabelPosition(
  text: ScreenBox,
  viewport: Pick<ScreenBox, 'width' | 'height'>,
  segments: readonly ScreenSegment[],
  occupied: readonly ScreenBox[],
): ScreenBox | undefined {
  for (const offset of offsets) {
    const x = text.x + offset.x;
    const y = text.y + offset.y;
    const right = x + text.width;
    const bottom = y + text.height;
    if (x < clearance || y < clearance || right > viewport.width - clearance || bottom > viewport.height - clearance) continue;
    if (occupied.some(box => x < box.x + box.width + clearance && box.x < right + clearance
      && y < box.y + box.height + clearance && box.y < bottom + clearance)) continue;
    const padded = { x: x - clearance, y: y - clearance, width: text.width + 2 * clearance, height: text.height + 2 * clearance };
    if (segments.some(segment => intersectsBox(padded, segment))) continue;
    return { x, y, width: text.width, height: text.height };
  }
  return undefined;
}
