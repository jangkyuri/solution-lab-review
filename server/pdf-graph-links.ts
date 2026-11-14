import { GraphLinkSchema } from '../shared/contracts.ts';
import type { Graph, GraphLink } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { graphCoordinate, graphPanel, inGraph, mapGraphPoint } from './pdf-graph-geometry.ts';
import type { GraphPanel, GraphPoint } from './pdf-graph-geometry.ts';
import { graphInlineLabel, graphMathLabel } from './pdf-graph-labels.ts';
import type { GraphLabel, GraphLabelPlacer } from './pdf-graph-labels.ts';
import { formatBookletInlineTex, safeMath } from './pdf-safety.ts';

type PreparedGraphLink = {
  readonly anchors: readonly GraphPoint[]; readonly anchorLabels?: readonly string[];
  readonly latex: string; readonly note: string; readonly color: 'blue' | 'brown';
  readonly mathWidth: number; readonly mathHeight: number;
};
type GraphCalculation = {
  readonly link: PreparedGraphLink; readonly left: number; readonly top: number; readonly width: number;
};
export type LinkedGraphLayout = {
  readonly panel: GraphPanel; readonly width: number; readonly height: number;
  readonly shift: GraphPoint; readonly laneWidth: number; readonly links: readonly PreparedGraphLink[];
  readonly calculations: readonly GraphCalculation[];
};

const samePoint = (first: GraphPoint, second: GraphPoint) =>
  Math.abs(first.x - second.x) < 1e-8 && Math.abs(first.y - second.y) < 1e-8;

export function graphPointLinkColor(point: GraphPoint, layout: LinkedGraphLayout | null): 'blue' | 'brown' | null {
  return layout?.links.find((link) => link.anchors.some((anchor) => samePoint(anchor, point)))?.color ?? null;
}

export function graphPointIsLinked(point: GraphPoint, layout: LinkedGraphLayout | null): boolean {
  return layout?.links.some((link) => link.anchors.some((anchor) => samePoint(anchor, point))) ?? false;
}

export function repeatedLinkedHeight(point: GraphPoint, graph: Graph, layout: LinkedGraphLayout | null): boolean {
  if (!layout || !graphPointIsLinked(point, layout)) return false;
  return graph.horizontals.some((line) => Math.abs(line.y - point.y) < 1e-8)
    || layout.links.flatMap((link) => link.anchors).filter((anchor) => Math.abs(anchor.y - point.y) < 1e-8).length > 1;
}

export function horizontalCurveIsLabelled(value: number, graph: Graph): boolean {
  return graph.curves.some((curve) => {
    const samples = curve.segments.length ? curve.segments.flat() : curve.samples;
    return samples.length >= 2 && samples.every((point) => Math.abs(point.y - value) < 1e-8)
      && graphMathLabel(curve.label) !== null;
  });
}

function noteHeight(note: string, width: number): number {
  return note.trim() ? Math.ceil(graphInlineLabel(note).width / width) * 13 : 0;
}

function calculationRows(links: readonly PreparedGraphLink[], width: number): {
  readonly calculations: readonly GraphCalculation[]; readonly height: number;
} {
  const columns = width >= 420 ? 2 : 1;
  const columnWidth = (width - 56 - (columns - 1) * 20) / columns;
  const captionLinks = links.filter((link) => link.anchorLabels);
  const rows = Array.from({ length: Math.ceil(captionLinks.length / columns) }, (_, index) =>
    captionLinks.slice(index * columns, (index + 1) * columns));
  const heights = rows.map((row) => Math.max(...row.map((link) => link.mathHeight + noteHeight(link.note, columnWidth) + 12)));
  const height = heights.reduce((sum, row) => sum + row, 0);
  let top = height - 2;
  const calculations: GraphCalculation[] = [];
  for (const [index, row] of rows.entries()) {
    for (const [column, link] of row.entries()) calculations.push({ link, left: 28 + column * (columnWidth + 20), top, width: columnWidth });
    top -= heights[index] ?? 0;
  }
  return { calculations, height };
}

export function prepareLinkedGraph(graph: Graph, input: readonly GraphLink[] | undefined, requestedWidth?: number): LinkedGraphLayout | null {
  if (!input?.length) return null;
  if (input.length > 3) throw new AppError(400, '그래프 연결은 한 그림에 세 항목까지 넣을 수 있습니다.');
  if (requestedWidth !== undefined && !Number.isFinite(requestedWidth)) throw new AppError(400, '그래프 폭을 확인해 주세요.');
  const width = Math.min(510, Math.max(150, requestedWidth ?? 460));
  const laneWidth = Math.min(176, width - 44);
  const links = input.map((candidate): PreparedGraphLink => {
    const parsed = GraphLinkSchema.safeParse(candidate);
    if (!parsed.success) throw new AppError(400, '그래프에 연결할 점·수식·설명을 확인해 주세요.');
    const math = safeMath(parsed.data.latex);
    if (math === null) throw new AppError(400, '그래프 연결 수식에 지원하지 않는 명령이 있습니다.');
    const anchors = parsed.data.anchors.map((anchor) => {
      const source = graph.points.find((point) => samePoint(point, anchor));
      if (!source || !inGraph(anchor, graph) || !inGraph(source, graph)) throw new AppError(400, '그래프 연결점은 이 그림에 표시한 점의 좌표와 일치해야 합니다.');
      return { x: source.x, y: source.y };
    });
    if (anchors.some((anchor, index) => anchors.slice(0, index).some((previous) => samePoint(anchor, previous)))) {
      throw new AppError(400, '한 연결 안에 같은 점을 두 번 넣을 수 없습니다.');
    }
    const anchorLabels = parsed.data.anchorLabels;
    if (anchorLabels && (anchorLabels.length !== anchors.length || anchorLabels.some((label) => !label.trim()))) {
      throw new AppError(400, '점 옆 주석은 연결점마다 하나씩 작성해 주세요.');
    }
    if (anchorLabels?.some((label) => graphInlineLabel(label.trim()).width > laneWidth)) {
      throw new AppError(400, '점 옆 주석은 짧게 쓰고 자세한 식과 이유는 그림 아래에 넣어 주세요.');
    }
    const mathWidth = math.replace(/\\[A-Za-z]+/gu, 'x').replace(/[{}\s]/gu, '').length * 5.2;
    if (mathWidth > laneWidth) throw new AppError(400, '그래프 연결 수식은 짧은 식이나 항으로 나누어 주세요.');
    const mathHeight = /\\(?:[dt]?frac|int|sum)\b/u.test(math) ? 40 : 18;
    return { anchors, ...(anchorLabels ? { anchorLabels } : {}), latex: math, note: parsed.data.note, color: parsed.data.color, mathWidth, mathHeight };
  });
  const original = graphPanel(width);
  const panelHeight = Math.max(original.height, width >= 420 ? 240 : 190);
  const panel = { ...original, height: panelHeight, top: panelHeight - 24 };
  const calculations = calculationRows(links, width);
  const shift = calculations.height ? calculations.height + 8 : 0;
  const height = panel.height + shift;
  if (height > 580) throw new AppError(400, '좁은 그래프의 연결 설명을 나누어 주세요.');
  return { panel, width, height, shift: { x: 0, y: shift }, laneWidth, links, calculations: calculations.calculations };
}

function localEquation(link: PreparedGraphLink, availableWidth: number): GraphLabel {
  const width = Math.max(40, link.mathWidth * 1.75 + 10, Math.min(176, availableWidth, graphInlineLabel(link.note).width + 6));
  if (width > availableWidth) throw new AppError(400, '점 옆 수식은 짧은 식이나 항으로 나누어 주세요.');
  const note = link.note.trim()
    ? '{\\labeltext\\color{muted}\\fontsize{9.5bp}{13bp}\\selectfont ' + formatBookletInlineTex(link.note) + '}\\par\\vspace{1bp}' : '';
  return { width, height: link.mathHeight + noteHeight(link.note, width) + 2,
    tex: '\\begin{minipage}[t]{' + width.toFixed(3) + 'bp}\\raggedright ' + note + '\\mbox{\\(\\displaystyle ' + link.latex + '\\)}\\end{minipage}' };
}

export function drawGraphLinks(graph: Graph, layout: LinkedGraphLayout, labels: GraphLabelPlacer): string[] {
  const output: string[] = [];
  for (const link of layout.links) {
    const color = link.color === 'blue' ? 'accent' : 'warm';
    for (const [index, anchor] of link.anchors.entries()) {
      const source = mapGraphPoint(anchor, graph, layout.panel);
      output.push('\\draw[draw=' + color + ',line width=.75bp] ' + graphCoordinate(source) + ' circle (3.5bp);');
      const text = link.anchorLabels?.[index];
      if (text) output.push(labels.place(source, graphInlineLabel(text.trim()), anchor.y < 0 ? 'below' : 'above', color, 10));
    }
    if (!link.anchorLabels) {
      const center = link.anchors.reduce((sum, anchor) => ({ x: sum.x + anchor.x / link.anchors.length, y: sum.y + anchor.y / link.anchors.length }), { x: 0, y: 0 });
      output.push(labels.place(mapGraphPoint(center, graph, layout.panel), localEquation(link, layout.panel.width - 6), center.y < 0 ? 'below' : 'above', color));
    }
  }
  return output;
}

export function drawGraphLinkCalculations(layout: LinkedGraphLayout): string[] {
  return layout.calculations.flatMap(({ link, left, top, width }, index) => {
    const color = link.color === 'blue' ? 'accent' : 'warm';
    const name = 'graph-caption-' + index;
    const math = '\\node(' + name + ')[anchor=north west,inner sep=0bp,text=' + color + ',font=\\fontsize{10.2bp}{14bp}\\selectfont] at ('
      + left.toFixed(3) + ',' + top.toFixed(3) + ') {\\(\\displaystyle ' + link.latex + '\\)};';
    const note = link.note.trim() ? '\\node[anchor=north west,inner sep=0bp,text=muted,text width=' + width.toFixed(3)
      + 'bp,font=\\labeltext\\fontsize{9.5bp}{13bp}\\selectfont,align=left] at ([yshift=-4bp]' + name
      + '.south west) {' + formatBookletInlineTex(link.note) + '};' : '';
    return [math, note].filter(Boolean);
  });
}
