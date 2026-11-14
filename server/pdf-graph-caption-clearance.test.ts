import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphSchema, JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { drawGraphLinkCalculations, prepareLinkedGraph } from './pdf-graph-links.ts';
import { graphCurveLabel, graphMathLabel } from './pdf-graph-labels.ts';
import { compilePdf } from './pdf-runtime.ts';
import { renderPdfTex } from './pdf-template.ts';
import { renderBookletGraphTex } from './pdf-graph-native.ts';

describe('native graph caption clearance', () => {
  it('places a note below the actual bottom of a display fraction with tall parentheses', async () => {
    // Given: a caption with the tall display fractions that exceeded the old height estimate.
    const graph = GraphSchema.parse({ title: '', variable: 'x', xLabel: 'x', yLabel: 'y',
      xMin: -1, xMax: 4, yMin: -10, yMax: 10, curves: [], points: [{ x: 3, y: 0, label: '', open: false }],
      verticals: [], horizontals: [], arrows: [], shades: [], explanation: '' });
    const layout = prepareLinkedGraph(graph, [{ anchors: [{ x: 3, y: 0 }], anchorLabels: ['0'],
      latex: String.raw`f(3)=0,\qquad x_1'\left(\frac32\right)-x_2'\left(\frac32\right)=0`,
      note: 'CAPTION', color: 'blue' }], 460);
    if (!layout) throw new Error('Missing caption fixture');
    const stage = await mkdtemp(path.join(tmpdir(), 'solution-lab-caption-clearance-'));
    try {
      const job = JobSchema.parse({ ...jobFixture, result: { summary: '', questions: [], references: [], limitations: [] }, pdfDesign: BAEKSIN_V16_PDF_DESIGN });
      const preamble = renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[0];
      const [math, note] = drawGraphLinkCalculations(layout);
      if (!math || !note) throw new Error('Missing caption nodes');
      const existingName = math.match(/\\node\(([^)]+)\)/u)?.[1];
      const mathName = existingName ?? 'measured-math';
      const measuredMath = existingName ? math : math.replace('\\node[', '\\node(measured-math)[');
      const measuredNote = note.replace('\\node[', '\\node(measured-note)[');
      await mkdir(path.join(stage, 'build'));
      await writeFile(path.join(stage, 'main.tex'), preamble + String.raw`\begin{document}\pagestyle{empty}\begin{tikzpicture}[x=1bp,y=1bp]` + '\n'
        + [measuredMath, measuredNote, String.raw`\newdimen\mathbottom\newdimen\notetop`,
          String.raw`\pgfextracty{\mathbottom}{\pgfpointanchor{${mathName}}{south}}`,
          String.raw`\pgfextracty{\notetop}{\pgfpointanchor{measured-note}{north}}`,
          String.raw`\typeout{CAPTIONCLEARANCE=\the\dimexpr\mathbottom-\notetop\relax}`].join('\n')
        + String.raw`\end{tikzpicture}\end{document}`);

      // When: XeLaTeX measures the real math and note node boundaries.
      await compilePdf(stage);
      const log = await readFile(path.join(stage, 'build', 'main.log'), 'utf8');
      const measured = log.match(/CAPTIONCLEARANCE=(-?[\d.]+)pt/u)?.[1];
      if (!measured) throw new Error('Missing measured caption clearance');

      // Then: the note clears every formula glyph, including denominators and delimiters.
      expect(Number(measured)).toBeGreaterThan(2);
    } finally {
      if (path.dirname(stage) !== path.resolve(tmpdir()) || !path.basename(stage).startsWith('solution-lab-caption-clearance-')) throw new Error('Unexpected caption test directory');
      await rm(stage, { recursive: true, force: true });
    }
  }, 120_000);

  it('uses the function binding for a polynomial curve rather than placing its formula beside an ordinate', () => {
    // Given: a short polynomial label next to its separately marked function value.
    const label = 'f(x)=x³−3x²';
    // When: it becomes a curve identity in a single-curve graph.
    const actual = graphCurveLabel(label, false);
    // Then: the label remains an identity and cannot read as an equation with the adjacent ordinate.
    expect(actual).toEqual(graphMathLabel('f(x)'));
  });

  it('keeps the function identity for a chained y equation near the right graph edge', () => {
    // Given: a long generated curve label binds both y and the named function.
    const label = String.raw`\(y=f(x)=2x^3+9x^2-24x-7\)`;
    // When: the curve is labelled in its native graph.
    const actual = graphCurveLabel(label, false);
    // Then: the local identity fits the label bounds rather than clipping the polynomial.
    expect(actual).toEqual(graphMathLabel('f(x)'));
  });

  it('renders inline mathematics in an arrow note without literal delimiter text', () => {
    // Given: a transformation arrow includes a validated inline scalar.
    const graph = GraphSchema.parse({ title: '', variable: 'x', xLabel: 'x', yLabel: 'y', xMin: 0, xMax: 10, yMin: 0, yMax: 10,
      curves: [], points: [], verticals: [], horizontals: [], shades: [], explanation: '',
      arrows: [{ from: { x: 4, y: 6 }, to: { x: 7, y: 9 }, label: String.raw`오른쪽·위쪽으로 각각 \(3\)` }] });
    // When: its annotation is rendered.
    const tex = renderBookletGraphTex(graph);
    // Then: TeX receives math delimiters as structure rather than printed backslashes.
    expect(tex).toContain(String.raw`\(3\)`);
    expect(tex).not.toContain(String.raw`\textbackslash{}(`);
  });

  it('keeps a curve identity outside a nearby point equation box', () => {
    // Given: a curve identity near the vertex that carries a larger point equation.
    const graph = GraphSchema.parse({ title: '', variable: 'x', xLabel: 'x', yLabel: 'y', xMin: -2.4, xMax: 2.2, yMin: -1.5, yMax: 4,
      curves: [{ label: 'g(x), x≤0', expression: 'unused', color: 'blue', dashed: false, from: -2.4, to: 0,
        samples: Array.from({ length: 201 }, (_, index) => { const x = -2.4 + index * .012; return { x, y: -(x ** 3) - 4.5 * x ** 2 - 6 * x }; }), segments: [] },
        { label: 'g(x)=f(x), x>0', expression: 'unused', color: 'brown', dashed: false, from: 0, to: 2.2, segments: [],
          samples: Array.from({ length: 201 }, (_, index) => ({ x: index * .011, y: -3 * (index * .011 - 1) ** 2 + 3 })) }],
      points: [{ x: -2, y: 2, label: '(-2, 2)', open: false }, { x: -1, y: 2.5, label: '(-1, 5/2)', open: false },
        { x: 0, y: 0, label: '(0, 0)', open: false }, { x: 1, y: 3, label: '(1, 3)', open: false }],
      verticals: [{ x: -2, label: '' }, { x: 1, label: '' }], horizontals: [{ y: 3, label: '' }], arrows: [], shades: [], explanation: '' });
    // When: the ordinary identity and the local formula share one native canvas.
    const tex = renderBookletGraphTex(graph, { width: 460, graphLinks: [{ anchors: [{ x: 1, y: 3 }],
      latex: 'f(x)=-3(x-1)^2+3', note: '꼭짓점이 정해지고 원점을 지나므로 이차함수의 계수가 정해진다.', color: 'brown' }] });
    const identity = tex.split('\n').find((line) => line.endsWith('{\\(g(x)\\)};'));
    const equation = tex.split('\n').find((line) => line.includes('\\mbox{\\(\\displaystyle f(x)='));
    const first = identity?.match(/at \(([-\d.]+),([-\d.]+)\)/u);
    const second = equation?.match(/at \(([-\d.]+),([-\d.]+)\).*minipage\}\[t\]\{([\d.]+)bp/u);
    if (!first?.[1] || !first[2] || !second?.[1] || !second[2] || !second[3]) throw new Error('Missing placed formula or curve identity');
    const overlapX = Math.max(0, Math.min(Number(first[1]) + 20.8, Number(second[1]) + Number(second[3])) - Math.max(Number(first[1]), Number(second[1])));
    const overlapY = Math.max(0, Math.min(Number(first[2]) + 14, Number(second[2]) + 46) - Math.max(Number(first[2]), Number(second[2])));
    // Then: the white formula node cannot partially erase the curve identity.
    expect(overlapX * overlapY).toBe(0);
  });
});
