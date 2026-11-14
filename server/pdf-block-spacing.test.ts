import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ResultSchema, StepSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN, DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import { generatedFixture, jobFixture } from './generation-fixtures.ts';
import { renderBookletStep } from './pdf-booklet-layout.ts';
import { renderPdfTex } from './pdf-template.ts';
import { compilePdf, runPdfProcess } from './pdf-runtime.ts';

const inspectSpacing = String.raw`
import json, sys
import pdfplumber
with pdfplumber.open(sys.argv[1]) as document:
    page = document.pages[0]
    blue = [c for c in page.chars if c["non_stroking_color"] == (0, 0, 1)]
    red = [c for c in page.chars if c["non_stroking_color"] == (1, 0, 0)]
    before, after = (red, blue) if sys.argv[2] == "key" else (blue, red)
    print(json.dumps({"pages": len(document.pages), "gap": min(c["top"] for c in after)-max(c["bottom"] for c in before),
      "bodySizes": [c["size"] for c in page.search("BeforeMarker")[0]["chars"]] if sys.argv[2] == "key" else []}))
`;
const InspectionSchema = z.object({ pages: z.number(), gap: z.number(), bodySizes: z.array(z.number()) });

async function inspectionPython(directory: string): Promise<string> {
  const configured = process.env['SOLUTION_LAB_PDF_INSPECTION_PYTHON'];
  if (configured) return configured;
  const located = await runPdfProcess('where.exe', ['pdfinfo.exe'], directory, 10_000);
  const executable = located.stdout.trim().split(/\r?\n/u)[0];
  if (!executable) throw new Error('Missing bundled PDF inspection runtime');
  return path.resolve(path.dirname(executable), '..', '..', '..', '..', 'python', 'python.exe');
}

describe('booklet block boundary spacing', () => {
  it.each([
    { name: 'Q30 prose to keyed derivative', kind: 'key', graphPath: undefined,
      latex: String.raw`f(x)=\frac{d}{dx}\left(3x^3-2x^2+5\right)=9x^2-4x`,
      explanation: 'BeforeMarker 다항함수는 연속이므로 양변을 미분하면 적분 안의 함수가 나온다.', answer: '',
      booklet: { equationRole: 'key', table: [['미분할 항', '미분 결과'], [String.raw`\(3x^3\)`, String.raw`\(9x^2\)`],
        [String.raw`\(-2x^2\)`, String.raw`\(-4x\)`], [String.raw`\(5\)`, String.raw`\(0\)`]] } },
    { name: 'Q34 integral to answer', kind: 'answer', graphPath: undefined,
      latex: String.raw`2\int_0^3(5x^4-3x^2)\,dx=2\left[x^5-x^3\right]_0^3=2(243-27)=432`,
      explanation: '', answer: '432', booklet: undefined },
    { name: 'inline fractions to fraction answer', kind: 'answer', graphPath: undefined, latex: '',
      explanation: String.raw`최솟값은 \(a=\frac13\)을 대입하여 \(\frac{34}{27}\)로 구한다.`,
      answer: String.raw`\(\frac{34}{27}\)`, booklet: undefined },
    { name: 'Q33 fractional table to fraction answer', kind: 'answer', graphPath: undefined, latex: '', explanation: '',
      answer: String.raw`\(\frac{34}{3}\)`, booklet: { table: [['적분 구간', '끝값 대입', '적분값'],
        [String.raw`\([-2,-1]\)`, String.raw`\(\frac53-\left(-\frac23\right)\)`, String.raw`\(\frac73\)`],
        [String.raw`\([-1,2]\)`, String.raw`\(\frac{22}3-\left(-\frac53\right)\)`, String.raw`\(9\)`]] } },
    { name: 'Q4 displayed fraction to side-panel prose', kind: 'side', graphPath: 'graph-main.tex',
      latex: String.raw`\begin{aligned}\frac{(a+1)+3\left(a-\frac5{27}\right)}4&=0,\\4a+\frac49&=0,\\a&=-\frac19.\end{aligned}`,
      explanation: '내분점이 축 위에 있으므로 세로좌표는 0이다.', answer: '', booklet: { figure: 'side' } },
  ].flatMap(test => [false, true].map(compactReference => ({ ...test, compactReference }))))('separates $name using actual glyph bounds (finished=$compactReference)', async ({ name, kind, graphPath, latex, explanation, answer, booklet, compactReference }) => {
    // Given: actual corpus block shapes, with color-only instrumentation for glyph grouping.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-block-spacing-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const step = StepSchema.parse({ id: 'S02', after: [], branch: null, title: '', originalStep: '', evidence: '',
        latex, explanation, graph: null, booklet });
      const original = structuredClone(step);
      if (graphPath) await writeFile(path.join(directory, graphPath), String.raw`\rule{190bp}{120bp}`, 'utf8');
      const preamble = renderPdfTex({ ...jobFixture, pdfDesign: compactReference ? DEFAULT_PDF_DESIGN : BAEKSIN_V16_PDF_DESIGN, result: ResultSchema.parse({ ...generatedFixture(), questions: [] }) }, [], new Map()).split(String.raw`\begin{document}`)[0];
      if (!preamble) throw new Error('Missing booklet preamble');
      let body = renderBookletStep({ step, graphPath, zoomPath: undefined, compactReference }, answer, '');
      body = body.replaceAll(String.raw`\[\displaystyle`, String.raw`\[\color{blue}\displaystyle`)
        .replaceAll(String.raw`\baeksinkeymath{`, String.raw`\baeksinkeymath{\color{blue}`)
        .replaceAll(String.raw`\color{black}\noindent\textbf{정답}`, String.raw`\color{red}\noindent\textbf{정답}`)
        .replaceAll(String.raw`\begingroup\raggedright`, String.raw`\begingroup\color{${kind === 'answer' ? 'blue' : 'red'}}\raggedright`);
      if (kind === 'answer') body = body.replaceAll(String.raw`\begin{tabular}`, String.raw`\color{blue}\begin{tabular}`);
      const tex = preamble + String.raw`\begin{document}\fontsize{11.2bp}{18.2bp}\selectfont
\begin{baeksingroup}{B}` + body + String.raw`\end{baeksingroup}\end{document}`;
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');

      // When: the production booklet renderer compiles each real boundary shape.
      expect(await compilePdf(directory)).toBe(1);
      const python = await inspectionPython(directory);
      const inspected = await runPdfProcess(python, ['-c', inspectSpacing, path.join(directory, 'build', 'main.pdf'), kind], directory, 30_000);
      const geometry = InspectionSchema.parse(JSON.parse(inspected.stdout));
      const evidenceRoot = process.env['SOLUTION_LAB_PDF_SPACING_EVIDENCE'];
      if (evidenceRoot) {
        const evidenceDirectory = path.join(evidenceRoot, path.basename(directory));
        await cp(directory, evidenceDirectory, { recursive: true });
        await writeFile(path.join(evidenceDirectory, 'inspection.json'), JSON.stringify({ name, ...geometry }, null, 2), 'utf8');
      }

      // Then: the visible mathematical glyphs leave a readable gap without changing content or body size.
      expect(geometry.gap).toBeGreaterThanOrEqual(8);
      expect(geometry.bodySizes.every(size => Math.abs(size - 11.2) < .02)).toBe(true);
      expect(step).toStrictEqual(original);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-block-spacing-')) throw new Error('Unexpected block test directory');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);
});
