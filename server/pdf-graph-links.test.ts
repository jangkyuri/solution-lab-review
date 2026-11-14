import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphSchema, JobSchema } from '../shared/contracts.ts';
import type { GraphLink } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { AppError } from './errors.ts';
import { jobFixture } from './generation-fixtures.ts';
import { prepareLinkedGraph } from './pdf-graph-links.ts';
import { mapGraphPoint } from './pdf-graph-geometry.ts';
import { renderBookletGraphTex } from './pdf-graph-native.ts';
import { compilePdf } from './pdf-runtime.ts';
import { renderPdfTex } from './pdf-template.ts';

const slash = String.fromCharCode(92);
const graph = GraphSchema.parse({
  title: '', xMin: -3, xMax: 3, yMin: -2, yMax: 6, xLabel: 'x', yLabel: 'y', explanation: '', variable: 'x',
  curves: [{ label: 'f(x)', expression: 'unused', from: -3, to: 3, color: 'blue', dashed: false, segments: [],
    samples: [{ x: -3, y: 5 }, { x: -2, y: 4 }, { x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 5 }] },
  { label: 'y=4', expression: 'unused', from: -3, to: 3, color: 'brown', dashed: false, segments: [],
    samples: [{ x: -3, y: 4 }, { x: 3, y: 4 }] }],
  points: [{ x: -2, y: 4, label: '교점', open: false }, { x: 2, y: 4, label: '교점', open: false },
    { x: -2.4, y: 4, label: '왼쪽 교점', open: false }],
  verticals: [{ x: -2.4, label: '약 -2.4' }], horizontals: [{ y: 4, label: '4' }],
  arrows: [{ from: { x: -2.4, y: -1 }, to: { x: -2.4, y: 4 }, label: '대칭' }], shades: [],
});
const links: readonly GraphLink[] = [
  { anchors: [{ x: -2, y: 4 }, { x: 2, y: 4 }], latex: 'x^2=4', note: '높이 ' + slash + '(4' + slash + ')인 두 점', color: 'blue' },
  { anchors: [{ x: -2.4, y: 4 }], latex: 'u=-4', note: slash + '(x=-2.4' + slash + ')의 높이', color: 'brown' },
];

describe('native graph to equation links', () => {
  it('puts a point equation beside its source without a routed leader', () => {
    // Given a height read directly from one existing point.
    const localLinks = [{ anchors: [{ x: 2, y: 4 }], latex: '2+k=k+2', note: '위로 이동', color: 'blue' }] satisfies readonly GraphLink[];
    const layout = prepareLinkedGraph(graph, localLinks);
    if (!layout) throw new Error('Missing direct annotation layout');
    // When the native graph is rendered at its available width.
    const tex = renderBookletGraphTex(graph, { graphLinks: localLinks });
    // Then the equation stays near the point and no tracking line is introduced.
    expect(layout.panel.width).toBe(layout.width);
    expect(tex).not.toContain('line width=.5bp,opacity=.8');
    expect(tex).not.toContain('line width=.6bp');
    expect(tex).toContain(slash + 'mbox{' + slash + '(' + slash + 'displaystyle 2+k=k+2');
    const equation = tex.split('\n').find((line) => line.includes('2+k=k+2'));
    const match = equation?.match(/at \(([-\d.]+),([-\d.]+)\)/u);
    if (!match?.[1] || !match[2]) throw new Error('Missing direct equation position');
    const source = mapGraphPoint({ x: 2, y: 4 }, graph, layout.panel);
    expect(Math.hypot(Number(match[1]) - source.x, Number(match[2]) - source.y)).toBeLessThan(130);
  });

  it('keeps point equations local in one native canvas without altering data', () => {
    const before = structuredClone(graph);
    const tex = renderBookletGraphTex(graph, { graphLinks: links });
    expect(tex.match(/\\begin\{tikzpicture\}/gu)).toHaveLength(1);
    expect(tex.match(/circle \(3.5bp\)/gu)).toHaveLength(3);
    expect(tex.match(/x\^2=4/gu)).toHaveLength(1);
    expect(tex).toContain('text=warm');
    expect(tex).toContain('draw=warm,line width=.85bp');
    expect(tex).toContain('shorten >=5bp');
    expect(tex).toContain('>=latex');
    expect(tex).not.toContain(slash + '(-2.4' + slash + ')');
    expect(tex).not.toContain('resizebox');
    expect(tex.split('\n').some((line) => line.endsWith('{' + slash + '(4' + slash + ')};'))).toBe(false);
    expect(tex).toContain(slash + '(y=4' + slash + ')');
    expect(graph).toStrictEqual(before);
  });

  it('preserves plain graph output and keeps direct equations in narrow slots', () => {
    expect(renderBookletGraphTex(graph, { graphLinks: [] })).toBe(renderBookletGraphTex(graph));
    const narrow = renderBookletGraphTex(graph, { width: 250, graphLinks: links });
    expect(narrow).toContain('(250,');
    expect(narrow).not.toContain('(460,');
    expect(narrow).not.toContain('line width=.5bp,opacity=.8');
    expect(narrow).toContain(slash + 'fontsize{10.2bp}{14bp}');
  });

  it('rejects unsupported targets and points that are absent or out of bounds', () => {
    expect(() => renderBookletGraphTex(graph, { graphLinks: [{ ...links[0], anchors: [{ x: 0, y: 2 }], latex: 'x=2', note: '', color: 'blue' }] })).toThrow(AppError);
    expect(() => renderBookletGraphTex(graph, { graphLinks: [{ anchors: [{ x: 9, y: 4 }], latex: 'x=9', note: '', color: 'blue' }] })).toThrow(AppError);
    expect(() => renderBookletGraphTex(graph, { graphLinks: [{ anchors: [{ x: 2, y: 4 }], latex: slash + 'input{untrusted}', note: '', color: 'blue' }] })).toThrow(AppError);
  });

  it('escapes reason text while retaining a safe mathematical target', () => {
    const tex = renderBookletGraphTex(graph, { graphLinks: [{ anchors: [{ x: 2, y: 4 }],
      latex: 'x^2=4', note: '설명 ' + slash + 'input{untrusted}', color: 'blue' }] });
    expect(tex).toContain(slash + 'textbackslash{}input');
    expect(tex).not.toContain(slash + 'input{untrusted}');
  });


  it('renders validated inline note math while escaping unsafe commands and controls', () => {
    const note = '점 ' + slash + '(x=2' + slash + ')의 높이' + String.fromCharCode(0);
    const tex = renderBookletGraphTex(graph, { graphLinks: [{ anchors: [{ x: 2, y: 4 }],
      latex: 'x^2=4', note, color: 'blue' }] });
    expect(tex).toContain('점 ' + slash + '(x=2' + slash + ')의 높이');
    expect(tex).not.toContain(slash + 'textbackslash{}(');
    expect(tex).not.toContain(String.fromCharCode(0));
    const unsafe = renderBookletGraphTex(graph, { graphLinks: [{ anchors: [{ x: 2, y: 4 }],
      latex: 'x^2=4', note: '설명 ' + slash + '(' + slash + 'input{untrusted}' + slash + ')', color: 'blue' }] });
    expect(unsafe).not.toContain(slash + 'input{untrusted}');
    expect(unsafe).toContain(slash + 'textbackslash{}input');
  });


  it('puts a short label at each point and collects the related calculations below', () => {
    // Given three individually counted intersections, including one tangent point.
    const labelled: readonly GraphLink[] = [
      { anchors: [{ x: -2, y: 4 }, { x: 2, y: 4 }], anchorLabels: ['접해도 1개', '1개'], latex: 'x^2=4', note: '', color: 'blue' },
      { anchors: [{ x: -2.4, y: 4 }], anchorLabels: ['1개'], latex: 'u=-4', note: '반사 전 높이 ' + slash + '(-4' + slash + ')', color: 'brown' },
    ];
    // When labels and calculations are rendered together.
    const layout = prepareLinkedGraph(graph, labelled);
    if (!layout) throw new Error('Missing direct annotation layout');
    const tex = renderBookletGraphTex(graph, { graphLinks: labelled });
    // Then short labels stay by the points while equations stay under the plot.
    const pointLabels = tex.split('\n').filter((line) => line.includes('{\\labeltext ') && line.includes('1개'));
    expect(pointLabels).toHaveLength(3);
    for (const [index, line] of pointLabels.entries()) {
      const match = line.match(/at \(([-\d.]+),([-\d.]+)\)/u);
      const point = labelled.flatMap((link) => link.anchors)[index];
      if (!point || !match?.[1] || !match[2]) throw new Error('Missing direct point label position');
      const source = mapGraphPoint(point, graph, layout.panel);
      expect(Math.hypot(Number(match[1]) - source.x, Number(match[2]) - source.y)).toBeLessThan(100);
    }
    for (const formula of ['x^2=4', 'u=-4']) {
      const equation = tex.split('\n').find((line) => line.includes(formula));
      const match = equation?.match(/at \(([-\d.]+),([-\d.]+)\)/u);
      if (!match?.[2]) throw new Error('Missing calculation position');
      expect(Number(match[2])).toBeLessThan(layout.shift.y);
    }
    expect(tex).not.toContain('line width=.5bp,opacity=.8');
    expect(tex).not.toContain('line width=.6bp');
    expect(tex).toContain('draw=warm,fill=warm,line width=.85bp');
    expect(tex).toContain('draw=warm,line width=.85bp');
    expect(tex).toContain('반사 전 높이 ' + slash + '(-4' + slash + ')');
  });

  it('rejects missing or empty per-point labels before drawing', () => {
    // Given annotations that do not describe each supplied point.
    const first = links[0];
    if (!first) throw new Error('Missing linked graph fixture');
    // When a graph is rendered, then malformed labels are rejected.
    expect(() => renderBookletGraphTex(graph, { graphLinks: [{ ...first, anchorLabels: ['1개'] }] })).toThrow(AppError);
    expect(() => renderBookletGraphTex(graph, { graphLinks: [{ ...first, anchorLabels: ['1개', ' '] }] })).toThrow(AppError);
    expect(() => renderBookletGraphTex(graph, { graphLinks: [{ ...first, anchorLabels: ['가'.repeat(80), '1개'] }] })).toThrow(AppError);
  });

  it('compiles direct notes and per-point labels with their calculations in one TeX pass', async () => {
    const stage = await mkdtemp(path.join(tmpdir(), 'solution-lab-linked-graph-test-'));
    try {
      const compileLinks: readonly GraphLink[] = links.map((link, index) => index === 0
        ? { ...link, anchorLabels: ['접해도 1개', '1개'] } : link);
      const job = JobSchema.parse({ ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN,
        result: { summary: '', references: [], limitations: [], questions: [{ number: '1', problemText: '점에서 식으로 연결한다.',
          firstDecision: '', variables: ['x'], observedOrder: [], steps: [{ id: 'S01', after: [], branch: null,
            title: '', explanation: '', latex: '', originalStep: '', evidence: '', graph, booklet: { figure: 'wide', graphLinks: compileLinks } }],
          answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] } }] } });
      await mkdir(path.join(stage, 'build'));
      await writeFile(path.join(stage, 'graph.tex'), renderBookletGraphTex(graph, { graphLinks: compileLinks }), 'utf8');
      await writeFile(path.join(stage, 'main.tex'), renderPdfTex(job, [], new Map([['0-0', 'graph.tex']])), 'utf8');
      expect(await compilePdf(stage)).toBeGreaterThanOrEqual(2);
      expect((await readFile(path.join(stage, 'build', 'main.pdf'))).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    } finally {
      if (path.dirname(stage) !== path.resolve(tmpdir()) || !path.basename(stage).startsWith('solution-lab-linked-graph-test-')) throw new Error('Unexpected linked graph test directory');
      await rm(stage, { recursive: true, force: true });
    }
  }, 120_000);
});
