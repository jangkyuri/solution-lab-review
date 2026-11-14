import type { Graph, StepBooklet } from '../shared/contracts.ts';
import { sampleMathExpression } from './math-engine.ts';

export function bookletGraphWidth(figure: StepBooklet['figure']): number {
  return figure === 'wide' ? 360 : figure === 'small' ? 150 : 190;
}

export function bookletFigure(booklet: StepBooklet | undefined, compactReference = false): NonNullable<StepBooklet['figure']> {
  if (booklet?.graphLinks?.length && !(compactReference && booklet.figure && booklet.figure !== 'wide')) return 'wide';
  return booklet?.figure ?? 'side';
}

export function bookletNativeGraphWidth(booklet: StepBooklet | undefined, compactReference = false): number {
  const figure = bookletFigure(booklet, compactReference);
  return booklet?.graphLinks?.length && figure === 'wide' ? 460 : bookletGraphWidth(figure);
}

export async function bookletInset(graph: Graph, zoom: StepBooklet['zoom']): Promise<Graph | null> {
  if (!zoom || zoom.xMin >= zoom.xMax || zoom.yMin >= zoom.yMax
    || zoom.xMin < graph.xMin || zoom.xMax > graph.xMax
    || zoom.yMin < graph.yMin || zoom.yMax > graph.yMax
    || (zoom.xMin === graph.xMin && zoom.xMax === graph.xMax && zoom.yMin === graph.yMin && zoom.yMax === graph.yMax)) return null;
  const contains = (point: { readonly x: number; readonly y: number }) =>
    zoom.xMin <= point.x && point.x <= zoom.xMax && zoom.yMin <= point.y && point.y <= zoom.yMax;
  const curves = graph.qualitative ? graph.curves : (await Promise.all(graph.curves.map(async (curve) => {
    const from = Math.max(curve.from, zoom.xMin);
    const to = Math.min(curve.to, zoom.xMax);
    if (from >= to) return null;
    const { segments } = await sampleMathExpression(curve.expression, from, to, graph.variable);
    return { ...curve, from, to, samples: segments.length === 1 ? segments[0] ?? [] : [], segments };
  }))).filter((curve) => curve !== null);
  const points = graph.points.filter(contains);
  const hasCurve = curves.some((curve) =>
    (curve.segments.length ? curve.segments : [curve.samples]).some((segment) =>
      segment.length >= 2 && segment.some(contains)));
  if (!hasCurve && !points.length) return null;
  return {
    ...graph, ...zoom, title: '',
    curves, points,
    verticals: graph.verticals.filter(({ x }) => zoom.xMin <= x && x <= zoom.xMax),
    horizontals: graph.horizontals.filter(({ y }) => zoom.yMin <= y && y <= zoom.yMax),
    arrows: graph.arrows.filter(({ from, to }) => contains(from) && contains(to)),
  };
}
