import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphSchema, JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { clipGraphPolyline } from './pdf-graph-geometry.ts';
import { graphNumber } from './pdf-graph-labels.ts';
import { renderBookletGraphTex } from './pdf-graph-native.ts';
import { buildJobPdf } from './pdf.ts';

const slash = String.fromCharCode(92);
const graph = GraphSchema.parse({
  title: '그래프 제목', variable: 't', xMin: -2, xMax: 2, yMin: -2, yMax: 4,
  xLabel: 't', yLabel: 'y', explanation: '',
  curves: [{ label: "g'(t)", expression: 'unused', color: 'blue', from: -2, to: 2, dashed: false,
    samples: [], segments: [
      [{ x: -2, y: -1e12 }, { x: -1, y: -1 }, { x: -.5, y: 1 }],
      [{ x: .5, y: 1 }, { x: 1, y: -1 }, { x: 2, y: 1e12 }],
    ],
  }],
  points: [{ x: 2 / 3, y: 89 / 27, label: '높이와 거리 89/27', open: true }],
  verticals: [], horizontals: [],
  arrows: [{ from: { x: 0, y: 0 }, to: { x: 0, y: -1 }, label: '1' }],
  shades: [],
});

describe('native Baeksin graph', () => {
  it('shows a point height once when the same value is already labelled on a horizontal guide', () => {
    // Given: unnamed extrema already have matching labelled horizontal guides.
    const scene = GraphSchema.parse({ ...graph, variable: 'x', xMin: -2, xMax: 3, yMin: -10, yMax: 3,
      curves: [], arrows: [], points: [{ x: -2 / 3, y: 40 / 27, label: '극대점', open: false },
        { x: 2, y: -8, label: '극소점', open: false }], horizontals: [{ y: 40 / 27, label: '40/27' }, { y: -8, label: '-8' }] });
    // When: rendering point markers and guide annotations.
    const tex = renderBookletGraphTex(scene);
    // Then: both markers remain, with only one copy of each numeric height.
    expect(tex.match(/circle \(2bp\)/gu)).toHaveLength(2);
    expect(tex.match(/\\frac\{40\}\{27\}/gu)).toHaveLength(1);
    expect(tex.match(/\{\\\(-8\\\)\}/gu)).toHaveLength(1);
  });

  it('retains a named point beside its matching labelled horizontal guide', () => {
    // Given: a named point carries information distinct from the guide's numeric value.
    const scene = GraphSchema.parse({ ...graph, curves: [], arrows: [],
      points: [{ x: 1, y: 3, label: 'P(1,3)', open: false }], horizontals: [{ y: 3, label: '3' }] });
    // When: rendering the point and guide.
    const tex = renderBookletGraphTex(scene);
    // Then: the name is preserved.
    expect(tex).toContain('{\\(P\\)};');
  });

  it('omits an area label that cannot fit wholly inside the shaded region', () => {
    // Given: an area too narrow for the label at the booklet font size.
    const scene = GraphSchema.parse({ ...graph, curves: [], arrows: [], points: [], shades: [{ color: 'blue', label: '구하는 넓이',
      polygon: [{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: .1, y: 3 }, { x: 0, y: 3 }] }] });
    // When: producing graph annotations.
    const tex = renderBookletGraphTex(scene);
    // Then: shading remains but no label can cover either boundary.
    expect(tex).toContain('opacity=.10');
    expect(tex).not.toContain('구하는 넓이');
  });

  it('preserves a narrow area identifier with a leader outside its region', () => {
    // Given: an essential identifier matches the area to a calculation but cannot fit inside.
    const scene = GraphSchema.parse({ ...graph, curves: [], arrows: [], points: [], shades: [{ color: 'blue', label: 'S_1',
      polygon: [{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: .1, y: 3 }, { x: 0, y: 3 }] }] });
    // When: rendering the narrow shaded area.
    const tex = renderBookletGraphTex(scene);
    // Then: its name remains linked to the area without covering the boundary.
    expect(tex).toContain('{\\(S_1\\)};');
    expect(tex).toContain('->,draw=accent,line width=.55bp');
  });

  it('clips huge finite out-of-view geometry before producing separate paths', () => {
    const source = graph.curves[0];
    if (!source) throw new Error('Missing graph curve');
    const paths = source.segments.flatMap((segment) => clipGraphPolyline(segment, graph));
    expect(paths).toHaveLength(2);
    expect(paths.flat().every((point) => Math.abs(point.x) <= 2 && point.y >= -2.001 && point.y <= 4.001)).toBe(true);
    const tex = renderBookletGraphTex(graph);
    expect(tex.match(/plot coordinates/gu)).toHaveLength(2);
    expect(tex).not.toContain('1000000000000');
    expect(tex).not.toContain('unused');
    expect(tex).not.toContain('resizebox');
    expect(tex).not.toContain('그래프 제목');
    expect(graphNumber(89 / 27, '89/27')).toBe(slash + 'frac{89}{27}');
    expect(graphNumber(.6666666667)).toBe(slash + 'frac{2}{3}');
    expect(graphNumber(1e-7)).toBe('1' + slash + 'times 10^{-7}');
    expect(graphNumber(1e21)).toBe('1' + slash + 'times 10^{21}');
    expect(tex).toContain(slash + 'displaystyle ' + slash + 'frac{89}{27}');
  });

  it('escapes annotation commands and preserves dashed comparison geometry', () => {
    const unsafe = GraphSchema.parse({ ...graph,
      points: [{ x: 0, y: 3, label: slash + 'input{untrusted}', open: false }],
      curves: graph.curves.map((curve) => ({ ...curve, label: slash + 'write18{untrusted}', color: 'brown', dashed: true })),
      arrows: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, label: slash + 'input{untrusted}' }],
    });
    const tex = renderBookletGraphTex(unsafe, { width: 360 });
    expect(tex).toContain('draw=warm,line width=.85bp,dashed');
    expect(tex).not.toContain(slash + 'input{untrusted}');
    expect(tex).not.toContain(slash + 'write18');
    expect(tex).toContain(slash + 'textbackslash{}input');
    expect(tex).toContain('(360,200)');
  });


  it('labels sampled derivative sign intervals identified by the supplied Korean meaning', () => {
    const derivative = GraphSchema.parse({ ...graph, title: '절댓값 안의 식의 도함수', points: [],
      curves: graph.curves.map((curve) => ({ ...curve, label: '도함수', segments: [], samples: [
        { x: -2, y: -1 }, { x: -1, y: -1 }, { x: -.5, y: 1 },
        { x: 0, y: 1 }, { x: .5, y: -1 }, { x: 1, y: -1 },
      ] })),
    });
    const tex = renderBookletGraphTex(derivative);
    expect(tex).toContain(slash + '(+' + slash + ')');
    expect(tex).toContain(slash + '(-' + slash + ')');
  });


  it('uses only numerically matching supplied square roots', () => {
    expect(graphNumber(Math.sqrt(5), 'sqrt(5)')).toBe(slash + 'sqrt{5}');
    expect(graphNumber(-Math.sqrt(7), '-√7')).toBe('-' + slash + 'sqrt{7}');
    expect(graphNumber(Math.sqrt(11), slash + 'sqrt{11}')).toBe(slash + 'sqrt{11}');
    expect(graphNumber(Math.sqrt(5) + .001, 'sqrt(5)')).not.toContain(slash + 'sqrt');
  });

  it('separates negative point heights from projections and limits shared-curve labels', () => {
    const scene = GraphSchema.parse({
      ...graph, variable: 'x', xMin: -2, xMax: 3, yMin: -3, yMax: 5, xLabel: 'x', yLabel: 'y',
      points: [{ x: 1, y: -2, label: '(1,-2)', open: false }, { x: Math.sqrt(5), y: 0, label: 'sqrt(5)', open: false }],
      verticals: [], horizontals: [], arrows: [],
      curves: [
        { label: 'f(x)=|x^3-3x+2|', expression: 'unused', color: 'blue', dashed: false, from: -2, to: 3,
          samples: [{ x: -1, y: 4 }, { x: 1, y: 0 }, { x: 2, y: 4 }], segments: [] },
        { label: 'y=x^3-3x+2', expression: 'unused', color: 'gray', dashed: true, from: -2, to: 3,
          samples: [{ x: -1, y: 4 }, { x: 1, y: 0 }, { x: 2, y: 4 }], segments: [] },
        { label: 'y=4', expression: 'unused', color: 'brown', dashed: false, from: -2, to: 3,
          samples: [{ x: -2, y: 4 }, { x: 3, y: 4 }], segments: [] },
      ],
    });
    const tex = renderBookletGraphTex(scene);
    const labelBottom = (math: string) => {
      const suffix = '{' + slash + '(' + math + slash + ')};';
      const line = tex.split('\n').find((candidate) => candidate.endsWith(suffix));
      const match = line?.match(/\] at \(([-\d.]+),([-\d.]+)\)/u);
      if (!match?.[2]) throw new Error('Missing positioned graph label ' + math);
      return Number(match[2]);
    };
    expect(labelBottom('-2') + 14).toBeLessThan(labelBottom('1'));
    expect(tex).toContain(slash + 'sqrt{5}');
    expect(tex).toContain(slash + '(f(x)' + slash + ')');
    expect(tex).toContain(slash + '(y=4' + slash + ')');
    expect(tex).not.toContain('f(x)=|');
    expect(tex).not.toContain('y=x^3-3x+2');
    expect(tex).toContain('draw=muted,line width=.85bp,dashed');
  });

  it('compiles graph paths and full-size mathematical labels in the booklet font', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-native-graph-test-'));
    try {
      const job = JobSchema.parse({
        ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN,
        result: { summary: '', references: [], limitations: [], questions: [{
          number: '1', problemText: '그래프와 식을 비교한다.', firstDecision: '', variables: ['t'], observedOrder: [],
          steps: [{ id: 'S01', after: [], branch: null, title: '', explanation: '도함수의 부호를 확인한다.',
            latex: '', originalStep: '', evidence: '', graph, booklet: { figure: 'wide' } }],
          answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
        }] },
      });
      const output = await buildJobPdf(job, [], directory);
      expect(output.pageCount).toBeGreaterThanOrEqual(2);
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    } finally {
      if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('solution-lab-native-graph-test-')) throw new Error('Unexpected native graph test directory');
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
