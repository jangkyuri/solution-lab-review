import { escapeTex, formatBookletInlineTex, safeMath } from './pdf-safety.ts';
import { clipGraphLine } from './pdf-graph-geometry.ts';
import type { GraphPoint, GraphPanel } from './pdf-graph-geometry.ts';
import { findPolygonLabelBox } from './pdf-graph-shades.ts';

export type GraphLabel = { readonly tex: string; readonly width: number; readonly height?: number };
type LabelBox = { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };
type Segment = readonly [GraphPoint, GraphPoint];

const labelBox = (left: number, bottom: number, width: number, height: number): LabelBox => ({
  left, bottom, right: left + width, top: bottom + height,
});
const labelHeight = (label: GraphLabel) => label.height ?? (/\\(?:[dt]?frac|int|sum)\b/u.test(label.tex) ? 23 : 14);

function intersects([from, to]: Segment, box: LabelBox, clearance: number): boolean {
  const xMin = box.left - clearance;
  const xMax = box.right + clearance;
  const yMin = box.bottom - clearance;
  const yMax = box.top + clearance;
  return Math.max(from.x, to.x) >= xMin && Math.min(from.x, to.x) <= xMax
    && Math.max(from.y, to.y) >= yMin && Math.min(from.y, to.y) <= yMax
    && clipGraphLine(from, to, { xMin, xMax, yMin, yMax }) !== null;
}

export function graphNumber(value: number, supplied = ''): string {
  if (Object.is(value, -0) || value === 0) return '0';
  for (const match of supplied.matchAll(/(-?\d+)\s*\/\s*(\d+)/gu)) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator && Math.abs(numerator / denominator - value) < 1e-10 * Math.max(1, Math.abs(value))) {
      return (numerator < 0 ? '-' : '') + '\\frac{' + Math.abs(numerator) + '}{' + denominator + '}';
    }
  }
  const suppliedRoot = supplied.replace(/\u2212/gu, '-');
  for (const match of suppliedRoot.matchAll(/(-?)\s*(?:\\sqrt\s*\{\s*(\d+)\s*\}|sqrt\s*\(\s*(\d+)\s*\)|√\s*(\d+))/gu)) {
    const radicand = Number(match[2] ?? match[3] ?? match[4]);
    const sign = match[1] === '-' ? -1 : 1;
    if (Number.isSafeInteger(radicand) && radicand >= 0
      && Math.abs(sign * Math.sqrt(radicand) - value) < 1e-10 * Math.max(1, Math.abs(value))) {
      return (sign < 0 ? '-' : '') + '\\sqrt{' + radicand + '}';
    }
  }
  const scientific = String(value).match(/^(-?\d+(?:\.\d+)?)e([+-]?\d+)$/u);
  if (scientific) return scientific[1] + '\\times 10^{' + Number(scientific[2]) + '}';
  if (Number.isInteger(value)) return String(value);
  const raw = String(value);
  if (raw.length <= 8) return raw;
  for (let denominator = 2; denominator <= 100; denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(numerator / denominator - value) < 1e-10 * Math.max(1, Math.abs(value))) {
      return (numerator < 0 ? '-' : '') + '\\frac{' + Math.abs(numerator) + '}{' + denominator + '}';
    }
  }
  return '\\approx ' + Number(value.toPrecision(4)).toString();
}

export function graphMathLabel(value: string): GraphLabel | null {
  let normalized = value.trim().replace(/\u2212/gu, '-').replace(/\u2032/gu, "'");
  normalized = normalized.replace(/^\\\(([\s\S]*)\\\)$/u, '$1').replace(/^\$([^$]*)\$$/u, '$1')
    .replace(/≤/gu, '\\leq ').replace(/≥/gu, '\\geq ').replace(/≠/gu, '\\neq ')
    .replace(/(?<![\w.])(\d+)\/(\d+)(?![\w.])/gu, '\\frac{$1}{$2}');
  if (!normalized || normalized.length > 100 || /\\(?:begin|end)\b/u.test(normalized)) return null;
  const math = safeMath(normalized);
  if (math === null) return null;
  const visualLength = normalized.replace(/\\[A-Za-z]+/gu, 'x').replace(/[{}]/gu, '').length;
  return { tex: '\\(' + (math.includes('\\frac') ? '\\displaystyle ' : '') + math + '\\)', width: Math.max(10, visualLength * 5.2 + (normalized.match(/\\sqrt\b/gu)?.length ?? 0) * 6) };
}

export function graphCurveLabel(value: string, multiple: boolean): GraphLabel | null {
  const label = graphMathLabel(value);
  if (label === null) return null;
  const normalized = value.trim().replace(/^\\\(([\s\S]*)\\\)$/u, '$1').replace(/^\$([^$]*)\$$/u, '$1');
  const binding = normalized.match(/^(?:y\s*=\s*)?([A-Za-z](?:['′]|\\prime)?\([^()=]{1,10}\))\s*=/u)?.[1];
  if (binding) return graphMathLabel(binding);
  return multiple && label.width > 45 ? null : label;
}

export function graphTextLabel(value: string): GraphLabel {
  return { tex: '{\\labeltext ' + escapeTex(value) + '}', width: Math.max(10, Math.min(150, [...value].length * 9.2)) };
}

export function graphInlineLabel(value: string): GraphLabel {
  const visible = value.replace(/\\[A-Za-z]+/gu, 'x').replace(/[{}\\]/gu, '').replace(/[()]/gu, '');
  const width = [...visible].reduce((sum, character) => sum + (/[^\u0000-\u007f]/u.test(character) ? 9.2 : 5.2), 0);
  return { tex: '{\\labeltext ' + formatBookletInlineTex(value) + '}', width: Math.max(10, width + 4),
    height: /\\(?:[dt]?frac|int|sum)\b/u.test(value) ? 25 : 14 };
}

export function graphPointLabel(point: GraphPoint, supplied: string): GraphLabel {
  const named = supplied.trim().match(/^([A-Z](?:_\{?\d+\}?)?)(?:\s*[:=(（]|$)/u)?.[1];
  if (named) return graphMathLabel(named) ?? graphTextLabel(named);
  const math = graphMathLabel(supplied);
  if (math && math.width <= 95) return math;
  return graphMathLabel('(' + graphNumber(point.x, supplied) + ',' + graphNumber(point.y, supplied) + ')')
    ?? graphTextLabel(supplied);
}

export class GraphLabelPlacer {
  private readonly occupied: LabelBox[] = [];
  private readonly segments: Segment[] = [];
  private readonly markers: { readonly point: GraphPoint; readonly radius: number }[] = [];
  private readonly panel: GraphPanel;
  private outsideTop: number;

  constructor(panel: GraphPanel) {
    this.panel = panel;
    this.outsideTop = panel.height;
  }

  get height(): number { return this.outsideTop; }

  avoidSegment(from: GraphPoint, to: GraphPoint): void { this.segments.push([from, to]); }

  avoidPolyline(points: readonly GraphPoint[]): void {
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from && to) this.avoidSegment(from, to);
    }
  }

  avoidPoint(point: GraphPoint, radius: number): void { this.markers.push({ point, radius }); }

  private isClear(box: LabelBox): boolean {
    return !this.occupied.some((previous) => box.left < previous.right + 4 && box.right > previous.left - 4
      && box.bottom < previous.top + 4 && box.top > previous.bottom - 4)
      && !this.markers.some(({ point, radius }) => point.x >= box.left - radius - 2 && point.x <= box.right + radius + 2
        && point.y >= box.bottom - radius - 2 && point.y <= box.top + radius + 2)
      && !this.segments.some((segment) => intersects(segment, box, 3));
  }

  private drawLabel(box: LabelBox, label: GraphLabel, color: string): string {
    this.occupied.push(box);
    return '\\node[text=' + color + ',font=\\fontsize{10.2bp}{14bp}\\selectfont,inner sep=1bp,fill=white,anchor=south west] at ('
      + box.left.toFixed(3) + ',' + box.bottom.toFixed(3) + ') {' + label.tex + '};';
  }

  placeInside(polygon: readonly GraphPoint[], label: GraphLabel, color = 'ink'): string | null {
    const box = findPolygonLabelBox(polygon, label.width + 2, labelHeight(label) + 2, 3, this.occupied, (candidate) => this.isClear(candidate));
    if (!box) return null;
    return this.drawLabel(box, label, color);
  }

  placePolygonCallout(polygon: readonly GraphPoint[], label: GraphLabel, color = 'ink'): string | null {
    const interior = findPolygonLabelBox(polygon, 1, 1, 0);
    const anchor = interior ? { x: interior.left + .5, y: interior.bottom + .5 } : polygon[0];
    if (!anchor) return null;
    const width = label.width + 2;
    const height = labelHeight(label) + 2;
    const left = Math.min(...polygon.map((point) => point.x));
    const right = Math.max(...polygon.map((point) => point.x));
    const bottom = Math.min(...polygon.map((point) => point.y));
    const top = Math.max(...polygon.map((point) => point.y));
    const positions = [{ x: right + 8, y: anchor.y - height / 2 }, { x: left - width - 8, y: anchor.y - height / 2 },
      { x: anchor.x - width / 2, y: top + 8 }, { x: anchor.x - width / 2, y: bottom - height - 8 }];
    const edge = (box: LabelBox) => ({ x: Math.max(box.left, Math.min(box.right, anchor.x)), y: Math.max(box.bottom, Math.min(box.top, anchor.y)) });
    const candidates = positions.map((point) => labelBox(point.x, point.y, width, height))
      .filter((box) => box.left >= 2 && box.bottom >= 2 && box.right <= this.panel.width - 2 && box.top <= this.panel.height - 2
        && this.isClear(box) && !this.occupied.some((previous) => intersects([edge(box), anchor], previous, 2)));
    const distance = (box: LabelBox) => Math.hypot((box.left + box.right) / 2 - anchor.x, (box.bottom + box.top) / 2 - anchor.y);
    const box = candidates.reduce<LabelBox | undefined>((best, candidate) => !best || distance(candidate) < distance(best) ? candidate : best, undefined);
    if (!box) return null;
    const start = edge(box);
    this.avoidSegment(start, anchor);
    return '\\draw[->,draw=' + color + ',line width=.55bp] (' + start.x.toFixed(3) + ',' + start.y.toFixed(3) + ')--('
      + anchor.x.toFixed(3) + ',' + anchor.y.toFixed(3) + ');\n'
      + this.drawLabel(box, label, color);
  }

  place(point: GraphPoint, label: GraphLabel, preference: 'above' | 'below' | 'left' | 'right' = 'above', color = 'ink', separation = 0): string {
    const availableWidth = this.panel.width - 6;
    const fitted = label.width > availableWidth
      ? { ...label, width: availableWidth, tex: '\\resizebox{' + availableWidth.toFixed(3) + 'bp}{!}{' + label.tex + '}' }
      : label;
    const width = fitted.width + 2;
    const height = labelHeight(label) + 2;
    const shifts = {
      above: [{ x: 5, y: 6 + separation }, { x: -width - 5, y: 6 + separation }, { x: 5, y: -height - 6 - separation }, { x: -width - 5, y: -height - 6 - separation }],
      below: [{ x: -width / 2, y: -height - 4 - separation }, { x: 5, y: -height - 6 - separation }, { x: -width - 5, y: -height - 6 - separation }, { x: 5, y: 6 + separation }, { x: -width - 5, y: 6 + separation }],
      left: [{ x: -width - 6 - separation, y: -height / 2 }, { x: 5, y: 5 + separation }, { x: -width - 6 - separation, y: 5 }, { x: 5, y: -height - 5 - separation }],
      right: [{ x: 6 + separation, y: -height / 2 }, { x: 5, y: 5 + separation }, { x: 5, y: -height - 5 - separation }, { x: -width - 5 - separation, y: 5 }],
    } as const;
    const candidateAt = (shift: GraphPoint) => {
      const left = Math.max(2, Math.min(this.panel.width - width - 2, point.x + shift.x));
      const bottom = Math.max(2, Math.min(this.panel.height - height - 2, point.y + shift.y));
      return labelBox(left, bottom, width, height);
    };
    const candidates = shifts[preference].map(candidateAt);
    const nearby = candidates.find((candidate) => candidate.right <= this.panel.width - 2 && candidate.top <= this.panel.height - 2 && this.isClear(candidate));
    const preferred = candidateAt(shifts[preference][0]);
    const box = nearby ?? this.findSpace(preferred, width, height);
    if (box) return this.drawLabel(box, fitted, color);
    const outside = labelBox(preferred.left, this.outsideTop + 4, width, height);
    this.outsideTop = outside.top;
    return this.drawLabel(outside, fitted, color);
  }

  private findSpace(preferred: LabelBox, width: number, height: number): LabelBox | null {
    const maxLeft = this.panel.width - width - 2;
    const maxBottom = this.panel.height - height - 2;
    let best: LabelBox | null = null;
    let distance = Infinity;
    for (let left = 2; left <= maxLeft; left += 4) {
      for (let bottom = 2; bottom <= maxBottom; bottom += 4) {
        const nextDistance = (left - preferred.left) ** 2 + (bottom - preferred.bottom) ** 2;
        if (nextDistance >= distance) continue;
        const candidate = labelBox(left, bottom, width, height);
        if (this.isClear(candidate)) { best = candidate; distance = nextDistance; }
      }
    }
    return best;
  }
}
