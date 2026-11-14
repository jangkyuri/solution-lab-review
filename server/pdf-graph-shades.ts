import { clipGraphLine } from './pdf-graph-geometry.ts';
import type { GraphPoint } from './pdf-graph-geometry.ts';

export type GraphLabelBox = { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };

function insidePolygon(point: GraphPoint, polygon: readonly GraphPoint[]): boolean {
  let previous = polygon.at(-1);
  let inside = false;
  if (!previous) return false;
  for (const vertex of polygon) {
    if ((vertex.y > point.y) !== (previous.y > point.y)
      && point.x < (previous.x - vertex.x) * (point.y - vertex.y) / (previous.y - vertex.y) + vertex.x) inside = !inside;
    previous = vertex;
  }
  return inside;
}

const overlaps = (first: GraphLabelBox, second: GraphLabelBox) => first.left < second.right && first.right > second.left
  && first.bottom < second.top && first.top > second.bottom;

function boundaryClearance(box: GraphLabelBox, polygon: readonly GraphPoint[]): number {
  const corners = [{ x: box.left, y: box.bottom }, { x: box.right, y: box.bottom },
    { x: box.right, y: box.top }, { x: box.left, y: box.top }];
  if (!corners.every((point) => insidePolygon(point, polygon))) return -1;
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) continue;
    if (clipGraphLine(start, end, { xMin: box.left, xMax: box.right, yMin: box.bottom, yMax: box.top })) return -1;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const squaredLength = dx * dx + dy * dy;
    for (const point of corners) {
      const fraction = squaredLength ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength)) : 0;
      minimum = Math.min(minimum, Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy));
    }
    for (const point of [start, end]) minimum = Math.min(minimum,
      Math.hypot(Math.max(box.left - point.x, 0, point.x - box.right), Math.max(box.bottom - point.y, 0, point.y - box.top)));
  }
  return minimum;
}

export function findPolygonLabelBox(
  polygon: readonly GraphPoint[], width: number, height: number, clearance = 3,
  occupied: readonly GraphLabelBox[] = [], isClear?: (box: GraphLabelBox) => boolean,
): GraphLabelBox | null {
  if (polygon.length < 3) return null;
  const left = Math.min(...polygon.map((point) => point.x)) + clearance;
  const bottom = Math.min(...polygon.map((point) => point.y)) + clearance;
  const horizontal = Math.max(...polygon.map((point) => point.x)) - clearance - width - left;
  const vertical = Math.max(...polygon.map((point) => point.y)) - clearance - height - bottom;
  if (horizontal < 0 || vertical < 0) return null;
  const columns = Math.max(1, Math.ceil(horizontal / 2));
  const rows = Math.max(1, Math.ceil(vertical / 2));
  let best: GraphLabelBox | null = null;
  let bestClearance = clearance;
  for (let column = 0; column <= columns; column += 1) {
    for (let row = 0; row <= rows; row += 1) {
      const x = left + horizontal * column / columns;
      const y = bottom + vertical * row / rows;
      const box = { left: x, bottom: y, right: x + width, top: y + height };
      if (occupied.some((previous) => overlaps({ left: x - clearance, bottom: y - clearance,
        right: x + width + clearance, top: y + height + clearance }, previous))) continue;
      const space = boundaryClearance(box, polygon);
      if (space >= bestClearance && (!isClear || isClear(box))) { best = box; bestClearance = space; }
    }
  }
  return best;
}
