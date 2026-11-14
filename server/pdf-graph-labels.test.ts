import { describe, expect, it } from 'vitest';
import { GraphSchema } from '../shared/contracts.ts';
import { clipGraphLine, graphPanel, mapGraphPoint } from './pdf-graph-geometry.ts';
import { prepareLinkedGraph } from './pdf-graph-links.ts';
import { GraphLabelPlacer, graphMathLabel } from './pdf-graph-labels.ts';
import { renderBookletGraphTex } from './pdf-graph-native.ts';

const curve = (label: string, expression: string, color: 'blue' | 'brown' | 'gray', dashed: boolean,
  from: number, to: number, evaluate: (x: number) => number) => ({
  label, expression, color, dashed, from, to,
  samples: Array.from({ length: 201 }, (_, index) => {
    const x = from + (to - from) * index / 200;
    return { x, y: evaluate(x) };
  }),
  segments: [],
});

describe('graph point labels beside measurement arrows', () => {
  it('places equations in separate rows above a graph when every position inside crosses a line', () => {
    const panel = graphPanel(150);
    const labels = new GraphLabelPlacer(panel);
    for (let y = 0; y < panel.height; y += 10) {
      labels.avoidSegment({ x: 0, y }, { x: panel.width, y });
    }
    const label = graphMathLabel('y=-2x+5');
    if (!label) throw new Error('Missing curve equation');
    const bottom = (node: string) => {
      const position = node.match(/\] at \(([-\d.]+),([-\d.]+)\)/u)?.[2];
      if (!position) throw new Error('Missing equation position');
      return Number(position);
    };
    const first = bottom(labels.place({ x: 76, y: 70 }, label));
    const second = bottom(labels.place({ x: 76, y: 70 }, label));
    expect(first).toBeGreaterThan(panel.height);
    expect(second - first).toBeGreaterThan(16);
    expect(labels.height - second).toBeGreaterThanOrEqual(16);
  });

  it('leaves the x-axis visible under a curve equation in a plain graph', () => {
    const graph = GraphSchema.parse({
      title: '', variable: 'x', xLabel: 'x', yLabel: 'y', xMin: -2, xMax: 4, yMin: -4, yMax: 4,
      curves: [curve('y=-2x+5', '-2*x+5', 'brown', false, -2, 4, (x) => -2 * x + 5)],
      points: [], verticals: [], horizontals: [], explanation: '', shades: [], arrows: [],
    });
    const panel = graphPanel();
    const tex = renderBookletGraphTex(graph);
    const line = tex.split('\n').find((candidate) => candidate.endsWith('{\\(y=-2x+5\\)};'));
    const coordinates = line?.match(/\] at \(([-\d.]+),([-\d.]+)\)/u);
    const label = graphMathLabel('y=-2x+5');
    if (!coordinates?.[1] || !coordinates[2] || !label) throw new Error('Missing curve equation');
    const left = Number(coordinates[1]);
    const bottom = Number(coordinates[2]);
    const box = { xMin: left - 2, xMax: left + label.width + 2, yMin: bottom - 2, yMax: bottom + 16 };
    expect(clipGraphLine(mapGraphPoint({ x: -2, y: 0 }, graph, panel), mapGraphPoint({ x: 4, y: 0 }, graph, panel), box)).toBeNull();
    expect(clipGraphLine(mapGraphPoint({ x: .5, y: 4 }, graph, panel), mapGraphPoint({ x: 4, y: -3 }, graph, panel), box)).toBeNull();
  });

  it('keeps a named intercept clear of a length arrow when curves obstruct the first upper candidate', () => {
    // Given: the actual cubic/triangle scene has two horizontal height measurements below the x axis.
    const graph = GraphSchema.parse({
      title: '', variable: 'x', xLabel: 'x', yLabel: 'y', xMin: -1.5, xMax: 1.4, yMin: -1.5, yMax: 8,
      curves: [
        curve('주어진 곡선', '0.5*x^3+2.5*x+3', 'blue', false, -1.5, 1.4, (x) => .5 * x ** 3 + 2.5 * x + 3),
        curve('접선 AB', '4*x+2', 'brown', false, -.6, 1.4, (x) => 4 * x + 2),
        curve('변 AC', '3*x+3', 'gray', true, -1, 1, (x) => 3 * x + 3),
        curve('변 BC', '2*x+2', 'gray', true, -1, 0, (x) => 2 * x + 2),
      ],
      points: [
        { x: 1, y: 6, label: 'A(1, 6)', open: false },
        { x: 0, y: 2, label: 'B(0, 2)', open: false },
        { x: -1, y: 0, label: 'C(-1, 0)', open: false },
        { x: 0, y: 3, label: '(0, 3)', open: false },
      ],
      verticals: [], horizontals: [], explanation: '', shades: [],
      arrows: [
        { from: { x: -1, y: -.8 }, to: { x: 0, y: -.8 }, label: '높이 1' },
        { from: { x: 0, y: -.8 }, to: { x: 1, y: -.8 }, label: '높이 1' },
      ],
    });
    const graphLinks = [{ anchors: [{ x: 0, y: 3 }, { x: 0, y: 2 }],
      latex: '3-2=1', note: '세로축으로 나뉜 두 삼각형의 공통 밑변 길이이다.', color: 'brown' as const }];
    const layout = prepareLinkedGraph(graph, graphLinks, 460);
    if (!layout) throw new Error('Missing linked graph layout');

    // When: the real native graph renderer positions every annotation.
    const tex = renderBookletGraphTex(graph, { width: 460, graphLinks });

    // Then: C and its white node leave the measured horizontal segment visible.
    const line = tex.split('\n').find((candidate) => candidate.endsWith('{\\(C\\)};'));
    const coordinates = line?.match(/\] at \(([-\d.]+),([-\d.]+)\)/u);
    const label = graphMathLabel('C');
    if (!coordinates?.[1] || !coordinates[2] || !label) throw new Error('Missing point label C');
    const left = Number(coordinates[1]);
    const bottom = Number(coordinates[2]);
    const box = { xMin: left - 2, xMax: left + label.width + 2, yMin: bottom - 2, yMax: bottom + 16 };
    const overlaps = graph.arrows.map((arrow) => clipGraphLine(
      mapGraphPoint(arrow.from, graph, layout.panel), mapGraphPoint(arrow.to, graph, layout.panel), box));
    expect(overlaps).toEqual([null, null]);
  });
});
