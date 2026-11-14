import type { Graph } from '../shared/contracts.ts';

export type GraphPoint = { readonly x: number; readonly y: number };
export type GraphBounds = Pick<Graph, 'xMin' | 'xMax' | 'yMin' | 'yMax'>;
export type GraphPanel = {
  readonly width: number; readonly height: number;
  readonly left: number; readonly right: number; readonly bottom: number; readonly top: number;
};

export function graphPanel(width = 190): GraphPanel {
  const bounded = Math.min(510, Math.max(150, width));
  const height = bounded >= 300 ? 200 : bounded >= 220 ? 170 : bounded <= 150 ? 140 : 150;
  return { width: bounded, height, left: 28, right: bounded - 18, bottom: 25, top: height - 18 };
}

export function mapGraphPoint(point: GraphPoint, bounds: GraphBounds, panel: GraphPanel): GraphPoint {
  return {
    x: panel.left + (point.x - bounds.xMin) / (bounds.xMax - bounds.xMin) * (panel.right - panel.left),
    y: panel.bottom + (point.y - bounds.yMin) / (bounds.yMax - bounds.yMin) * (panel.top - panel.bottom),
  };
}

export function inGraph(point: GraphPoint, bounds: GraphBounds): boolean {
  return point.x >= bounds.xMin && point.x <= bounds.xMax && point.y >= bounds.yMin && point.y <= bounds.yMax;
}

export function clipGraphLine(from: GraphPoint, to: GraphPoint, bounds: GraphBounds): readonly [GraphPoint, GraphPoint] | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let start = 0;
  let end = 1;
  const edges = [
    [-dx, from.x - bounds.xMin], [dx, bounds.xMax - from.x],
    [-dy, from.y - bounds.yMin], [dy, bounds.yMax - from.y],
  ] as const;
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return null;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return null;
  }
  const first = { x: from.x + start * dx, y: from.y + start * dy };
  const last = { x: from.x + end * dx, y: from.y + end * dy };
  return [first, last].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ? [first, last] : null;
}

export function clipGraphPolyline(points: readonly GraphPoint[], bounds: GraphBounds): readonly (readonly GraphPoint[])[] {
  const paths: GraphPoint[][] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const clipped = clipGraphLine(from, to, bounds);
    if (!clipped) continue;
    const [first, last] = clipped;
    const path = paths.at(-1);
    const previous = path?.at(-1);
    if (previous && previous.x === first.x && previous.y === first.y) path?.push(last);
    else paths.push([first, last]);
  }
  return paths;
}

export function clipGraphPolygon(polygon: readonly GraphPoint[], bounds: GraphBounds): readonly GraphPoint[] {
  let output = [...polygon];
  const edges = [
    { dimension: 'x', limit: bounds.xMin, lower: true },
    { dimension: 'x', limit: bounds.xMax, lower: false },
    { dimension: 'y', limit: bounds.yMin, lower: true },
    { dimension: 'y', limit: bounds.yMax, lower: false },
  ] as const;
  for (const edge of edges) {
    const input = output;
    output = [];
    for (const [index, point] of input.entries()) {
      const previous = input[(index + input.length - 1) % input.length];
      if (!previous) continue;
      const inside = edge.lower ? point[edge.dimension] >= edge.limit : point[edge.dimension] <= edge.limit;
      const wasInside = edge.lower ? previous[edge.dimension] >= edge.limit : previous[edge.dimension] <= edge.limit;
      if (inside !== wasInside) {
        const ratio = (edge.limit - previous[edge.dimension]) / (point[edge.dimension] - previous[edge.dimension]);
        output.push({ x: previous.x + ratio * (point.x - previous.x), y: previous.y + ratio * (point.y - previous.y) });
      }
      if (inside) output.push(point);
    }
  }
  return output.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function graphCoordinate(point: GraphPoint): string {
  return '(' + point.x.toFixed(3) + ',' + point.y.toFixed(3) + ')';
}
