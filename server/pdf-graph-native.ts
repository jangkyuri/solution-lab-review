import type { Graph, GraphLink } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { drawGraphLinkCalculations, drawGraphLinks, graphPointIsLinked, graphPointLinkColor, horizontalCurveIsLabelled, prepareLinkedGraph, repeatedLinkedHeight } from './pdf-graph-links.ts';
import {
  clipGraphLine, clipGraphPolygon, clipGraphPolyline, graphCoordinate, graphPanel, inGraph, mapGraphPoint,
} from './pdf-graph-geometry.ts';
import type { GraphBounds, GraphPanel, GraphPoint } from './pdf-graph-geometry.ts';
import { GraphLabelPlacer, graphCurveLabel, graphInlineLabel, graphMathLabel, graphNumber, graphPointLabel } from './pdf-graph-labels.ts';

export type BookletGraphOptions = { readonly width?: number; readonly highlight?: GraphBounds; readonly graphLinks?: readonly GraphLink[] };
const colors = { blue: 'accent', brown: 'warm', gray: 'muted' } as const;
const close = (first: number, second: number) => Math.abs(first - second) <= 1e-10 * Math.max(1, Math.abs(first), Math.abs(second));

function sampledSignCues(graph: Graph, panel: GraphPanel, labels: GraphLabelPlacer): string[] {
  const [curve] = graph.curves;
  if (graph.qualitative || graph.curves.length !== 1 || !curve || !/['′]|\\prime|도함수/u.test([curve.label, graph.yLabel, graph.title].join(" ")) || !(graph.yMin < 0 && graph.yMax > 0)) return [];
  const output: string[] = [];
  for (const segment of curve.segments.length ? curve.segments : [curve.samples]) {
    let run: GraphPoint[] = [];
    const flush = () => {
      const first = run[0];
      const last = run.at(-1);
      if (first && last && run.length > 1) {
        const position = mapGraphPoint({ x: (first.x + last.x) / 2, y: 0 }, graph, panel);
        const positive = first.y > 0;
        output.push(labels.place(position, { tex: positive ? '\\(+\\)' : '\\(-\\)', width: 10 }, positive ? 'above' : 'below', positive ? 'accent' : 'warm'));
      }
      run = [];
    };
    for (const point of segment) {
      if (!inGraph(point, graph) || point.y === 0) { flush(); continue; }
      if (run[0] && Math.sign(run[0].y) !== Math.sign(point.y)) flush();
      run.push(point);
    }
    flush();
  }
  return output;
}

export function renderBookletGraphTex(graph: Graph, options: BookletGraphOptions = {}): string {
  if (![graph.xMin, graph.xMax, graph.yMin, graph.yMax].every(Number.isFinite)
    || graph.xMin >= graph.xMax || graph.yMin >= graph.yMax) {
    throw new AppError(400, '그래프 범위를 확인해 주세요.');
  }
  const linked = prepareLinkedGraph(graph, options.graphLinks, options.width);
  const panel = linked?.panel ?? graphPanel(options.width);
  const labels = new GraphLabelPlacer(panel);
  const geometry: string[] = [];
  const annotation: string[] = [];
  const queuedLabels: (() => string | null)[] = [];
  const origin = { x: 0, y: 0 };
  const xAxis = graph.yMin <= 0 && graph.yMax >= 0;
  const yAxis = graph.xMin <= 0 && graph.xMax >= 0;
  const map = (point: GraphPoint) => mapGraphPoint(point, graph, panel);
  const addLine = (from: GraphPoint, to: GraphPoint, style: string) => {
    const clipped = clipGraphLine(from, to, graph);
    if (!clipped) return;
    const first = map(clipped[0]);
    const last = map(clipped[1]);
    labels.avoidSegment(first, last);
    geometry.push('\\draw[' + style + '] ' + graphCoordinate(first) + '--' + graphCoordinate(last) + ';');
  };
  const placeMath = (point: GraphPoint, text: string, preference: 'above' | 'below' | 'left' | 'right' = 'above', color = 'ink') =>
    queuedLabels.push(() => labels.place(point, graphMathLabel(text) ?? graphInlineLabel(text), preference, color));
  for (const shade of graph.shades) {
    const polygon = clipGraphPolygon(shade.polygon, graph).map(map);
    if (polygon.length >= 3) {
      geometry.push('\\fill[' + colors[shade.color] + ',opacity=.10] ' + polygon.map(graphCoordinate).join('--') + '--cycle;');
      if (shade.label.trim() && shade.label.length <= 8) {
        const math = graphMathLabel(shade.label);
        queuedLabels.push(() => labels.placeInside(polygon, math ?? graphInlineLabel(shade.label), colors[shade.color])
          ?? (math ? labels.placePolygonCallout(polygon, math, colors[shade.color]) : null));
      }
    }
  }
  if (xAxis) {
    addLine({ x: graph.xMin, y: 0 }, { x: graph.xMax, y: 0 }, '->,draw=muted,line width=.55bp');
    const axisLabel = graph.xLabel.length <= 8 && graphMathLabel(graph.xLabel) ? graph.xLabel : graph.variable;
    placeMath({ x: panel.right + 1, y: map(origin).y }, axisLabel, 'right', 'muted');
  }
  if (yAxis) {
    addLine({ x: 0, y: graph.yMin }, { x: 0, y: graph.yMax }, '->,draw=muted,line width=.55bp');
    const axisLabel = graph.yLabel.length <= 8 && graphMathLabel(graph.yLabel) ? graph.yLabel : 'y';
    placeMath({ x: map(origin).x, y: panel.top + 2 }, axisLabel, 'above', 'muted');
  }
  const guideStyle = 'draw=rulegray,dashed,line width=.45bp';
  const seenX = new Set<number>();
  const seenY = new Set<number>();
  const labelledY = new Set<number>();
  for (const guide of graph.verticals) {
    if (guide.x < graph.xMin || guide.x > graph.xMax || (yAxis && close(guide.x, 0))) continue;
    seenX.add(guide.x);
    const matching = graph.points.filter((point) => close(point.x, guide.x) && inGraph(point, graph));
    const base = xAxis ? 0 : graph.yMin;
    const values = matching.map((point) => point.y);
    const from = values.length ? Math.min(base, ...values) : graph.yMin;
    const to = values.length ? Math.max(base, ...values) : graph.yMax;
    if (from !== to) addLine({ x: guide.x, y: from }, { x: guide.x, y: to }, guideStyle);
    const linkedX = linked?.links.some((link) => link.anchors.some((anchor) => Math.abs(anchor.x - guide.x) < 1e-8));
    if ((!linkedX || Number.isInteger(guide.x)) && (!close(guide.x, 0) || !yAxis)) placeMath(map({ x: guide.x, y: base }), graphNumber(guide.x, guide.label), 'below');
  }
  for (const guide of graph.horizontals) {
    if (guide.y < graph.yMin || guide.y > graph.yMax || (xAxis && close(guide.y, 0))) continue;
    seenY.add(guide.y);
    const matching = graph.points.filter((point) => close(point.y, guide.y) && inGraph(point, graph));
    const base = yAxis ? 0 : graph.xMin;
    const values = matching.map((point) => point.x);
    addLine(
      { x: values.length ? Math.min(base, ...values) : graph.xMin, y: guide.y },
      { x: values.length ? Math.max(base, ...values) : graph.xMax, y: guide.y },
      guideStyle,
    );
    if ((!linked || !horizontalCurveIsLabelled(guide.y, graph)) && (!close(guide.y, 0) || !xAxis)) {
      placeMath(map({ x: base, y: guide.y }), graphNumber(guide.y, guide.label), 'left');
      labelledY.add(guide.y);
    }
  }
  for (const curve of [...graph.curves].sort((first, second) => Number(second.dashed) - Number(first.dashed))) {
    const curveColor = colors[curve.color];
    for (const segment of curve.segments.length ? curve.segments : [curve.samples]) {
      for (const visible of clipGraphPolyline(segment, graph)) {
        const path = visible.map(map);
        labels.avoidPolyline(path);
        geometry.push('\\draw[draw=' + curveColor + ',line width=' + (curve.dashed ? '.85bp' : curve.color === 'blue' ? '1.15bp' : '1bp') + (curve.dashed ? ',dashed' : '') + ',line join=round] plot coordinates {'
          + path.map(graphCoordinate).join(' ') + '};');
      }
    }
    const label = graphCurveLabel(curve.label, graph.curves.length > 1);
    if (label && label.width < panel.width * .7 && curve.label !== graph.yLabel) {
      const visible = (curve.segments.length ? curve.segments.flat() : curve.samples).filter((point) => inGraph(point, graph));
      const target = graph.xMin + .78 * (graph.xMax - graph.xMin);
      const point = visible.reduce<GraphPoint | undefined>((best, candidate) => !best || Math.abs(candidate.x - target) < Math.abs(best.x - target) ? candidate : best, undefined);
      if (point) queuedLabels.push(() => labels.place(map(point), label, 'above', curveColor));
    }
  }
  for (const point of graph.points) {
    if (!inGraph(point, graph)) continue;
    const linkedColor = graphPointLinkColor(point, linked);
    const pointColor = linkedColor ? colors[linkedColor] : 'accent';
    const marker = map(point);
    labels.avoidPoint(marker, 2.5);
    annotation.push('\\draw[draw=' + pointColor + ',fill=' + (point.open ? 'white' : pointColor) + ',line width=.85bp] ' + graphCoordinate(marker) + ' circle (2bp);');
    const linkedPoint = graphPointIsLinked(point, linked);
    const named = /^[A-Z](?:_\{?\d+\}?)?(?:\s*[:=(（]|$)/u.test(point.label.trim());
    const onX = close(point.y, 0) && xAxis;
    const onY = close(point.x, 0) && yAxis;
    if (!named && onX && seenX.has(point.x)) continue;
    if (!named && onY && seenY.has(point.y)) continue;
    if (!onX && !onY && xAxis && !seenX.has(point.x) && (!linkedPoint || Number.isInteger(point.x))) {
      seenX.add(point.x);
      addLine({ x: point.x, y: 0 }, point, guideStyle);
      placeMath(map({ x: point.x, y: 0 }), graphNumber(point.x, point.label), 'below');
    }
    if (!named && linkedPoint && ((onX && !Number.isInteger(point.x)) || (!onX && repeatedLinkedHeight(point, graph, linked)))) continue;
    if (!named && !onX && [...labelledY].some((value) => close(value, point.y))) continue;
    const label = named ? graphPointLabel(point, point.label)
      : graphMathLabel(graphNumber(onX ? point.x : point.y, point.label)) ?? graphPointLabel(point, point.label);
    queuedLabels.push(() => labels.place(marker, label, onX || (xAxis && point.y < 0) ? 'below' : onY ? 'left' : 'above'));
  }
  if (xAxis && yAxis && !graph.points.some((point) => close(point.x, 0) && close(point.y, 0))) {
    placeMath(map(origin), '0', 'below');
  }
  for (const arrow of graph.arrows) {
    const linkedArrow = graphPointLinkColor(arrow.to, linked) ?? graphPointLinkColor(arrow.from, linked);
    const arrowColor = linkedArrow ? colors[linkedArrow] : 'accent';
    const directTransformation = graphPointIsLinked(arrow.to, linked);
    const arrowHead = inGraph(arrow.to, graph) ? '->,' + (directTransformation ? '>=latex,shorten >=5bp,' : '') : '';
    addLine(arrow.from, arrow.to, arrowHead + 'draw=' + arrowColor + ',line width=' + (directTransformation ? '.85bp' : '.65bp'));
    if (arrow.label.trim() && arrow.label.length <= 20) {
      const middle = { x: (arrow.from.x + arrow.to.x) / 2, y: (arrow.from.y + arrow.to.y) / 2 };
      if (inGraph(middle, graph)) placeMath(map(middle), arrow.label, Math.abs(arrow.from.x - arrow.to.x) < Math.abs(arrow.from.y - arrow.to.y) ? 'right' : 'above', linkedArrow ? arrowColor : 'ink');
    }
  }
  if (options.highlight) {
    const box = options.highlight;
    const style = 'draw=accent,line width=.65bp';
    addLine({ x: box.xMin, y: box.yMin }, { x: box.xMax, y: box.yMin }, style);
    addLine({ x: box.xMax, y: box.yMin }, { x: box.xMax, y: box.yMax }, style);
    addLine({ x: box.xMax, y: box.yMax }, { x: box.xMin, y: box.yMax }, style);
    addLine({ x: box.xMin, y: box.yMax }, { x: box.xMin, y: box.yMin }, style);
  }
  for (const link of linked?.links ?? []) {
    for (const anchor of link.anchors) {
      if (inGraph(anchor, graph)) labels.avoidPoint(map(anchor), 4);
    }
  }
  const linkAnnotations = linked ? drawGraphLinks(graph, linked, labels) : [];
  for (const place of queuedLabels) {
    const label = place();
    if (label) annotation.push(label);
  }
  annotation.push(...sampledSignCues(graph, panel, labels), ...linkAnnotations);
  const height = labels.height + (linked?.shift.y ?? 0);
  return [
    '\\begin{tikzpicture}[x=1bp,y=1bp,baseline=(current bounding box.south)]',
    '\\path[use as bounding box] (0,0) rectangle (' + (linked?.width ?? panel.width) + ',' + height + ');',
    ...(linked && linked.shift.y ? ['\\begin{scope}[shift={(' + linked.shift.x + ',' + linked.shift.y + ')}]'] : []),
    '\\begin{scope}\\clip (' + (panel.left - 3) + ',' + (panel.bottom - 3) + ') rectangle (' + (panel.right + 3) + ',' + (panel.top + 3) + ');',
    ...geometry.filter(Boolean), '\\end{scope}', ...annotation,
    ...(linked && linked.shift.y ? ['\\end{scope}'] : []),
    ...(linked ? drawGraphLinkCalculations(linked) : []), '\\end{tikzpicture}',
  ].join('\n');
}
