import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ResultSchema, StepSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { generatedFixture, jobFixture } from './generation-fixtures.ts';
import { renderBookletStep } from './pdf-booklet-layout.ts';
import { renderPdfTex } from './pdf-template.ts';
import { compilePdf, runPdfProcess } from './pdf-runtime.ts';

const inspectSpacing = String.raw`
import json, sys
import pdfplumber
with pdfplumber.open(sys.argv[1]) as document:
    page = document.pages[0]
    after = page.search("AfterTableMarker")[0]
    def marker_index(text):
        marker = page.search(text)[0]["chars"][0]
        return next(i for i, c in enumerate(page.chars) if c["text"] == marker["text"] and c["x0"] == marker["x0"] and c["top"] == marker["top"])
    first_index = marker_index("FirstRowMarker")
    last_index = marker_index("SecondRowMarker")
    after_index = marker_index("AfterTableMarker")
    first = page.chars[first_index:last_index]
    last = page.chars[last_index:after_index]
    print(json.dumps({"pages": len(document.pages), "afterGap": after["top"] - max(c["bottom"] for c in last),
        "rowGap": min(c["top"] for c in last) - max(c["bottom"] for c in first),
        "text": page.extract_text(), "bodySizes": [c["size"] for c in after["chars"]]}))
`;
const InspectionSchema = z.object({
  pages: z.number(), afterGap: z.number(), rowGap: z.number(), text: z.string(), bodySizes: z.array(z.number()),
});

async function inspectionPython(directory: string): Promise<string> {
  const configured = process.env['SOLUTION_LAB_PDF_INSPECTION_PYTHON'];
  if (configured) return configured;
  const located = await runPdfProcess('where.exe', ['pdfinfo.exe'], directory, 10_000);
  const executable = located.stdout.trim().split(/\r?\n/u)[0];
  if (!executable) throw new Error('Missing bundled PDF inspection runtime');
  return path.resolve(path.dirname(executable), '..', '..', '..', '..', 'python', 'python.exe');
}

describe('booklet table spacing', () => {
  it.each([
    { question: 4, table: [
      ['대입', '함숫값의 계산'],
      ['FirstRowMarker', String.raw`\(f(-1)=-1+1+1+a=a+1\)`],
      ['SecondRowMarker', String.raw`\(f(\frac13)=\frac1{27}+\frac19-\frac13+a=a-\frac5{27}\)`],
    ] },
    { question: '4A', table: [
      ['구간', String.raw`\(f'(x)\)의 부호`, String.raw`\(f(x)\)의 변화`],
      [String.raw`FirstRowMarker \(-1<x<\frac13\)`, String.raw`\(-\)`, '감소'],
      [String.raw`SecondRowMarker \(x>\frac13\)`, String.raw`\(+\)`, '증가'],
    ] },
    { question: 43, table: [
      ['연속인 적분 안의 식', '정적분을 나눈 식의 극한'],
      ['FirstRowMarker', String.raw`\(\lim_{x\to 3}\frac{\int_3^x(t^2+at)\,dt}{x-3}=9+3a\)`],
      ['SecondRowMarker', String.raw`\(\lim_{x\to 3}\frac{\int_3^x(t^3+at^2)\,dt}{x-3}=27+9a\)`],
    ] },
    { question: 44, table: [
      ['구간', '전개한 식', '정적분값'],
      ['FirstRowMarker', String.raw`\(x^3+4x^2+5x+2\)`, String.raw`\(\frac{2}{3}\)`],
      ['SecondRowMarker', String.raw`\(x^3-3x+2\)`, String.raw`\(\frac{3}{4}\)`],
    ] },
  ])('clears fractional rows and the following paragraph in question $question', async ({ question, table }) => {
    // Given: the reported two-row substitution table, followed by its reason.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-table-spacing-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const step = StepSchema.parse({ id: 'S02', after: [], branch: null, title: '', originalStep: '', evidence: '',
        latex: '', explanation: 'AfterTableMarker 극대·극소인 곳의 가로좌표를 원래 함수에 대입한다.', graph: null,
        booklet: { group: 'B', table },
      });
      const original = structuredClone(step);
      const preamble = renderPdfTex({ ...jobFixture, pdfDesign: BAEKSIN_V16_PDF_DESIGN, result: ResultSchema.parse({ ...generatedFixture(), questions: [] }) }, [], new Map()).split(String.raw`\begin{document}`)[0];
      if (!preamble) throw new Error('Missing booklet preamble');
      const body = renderBookletStep({ step, graphPath: undefined, zoomPath: undefined }, '', '');
      const tex = preamble + String.raw`\begin{document}\fontsize{11.2bp}{18.2bp}\selectfont\lineskiplimit=2.5bp\lineskip=3bp
\begin{baeksingroup}{B}` + body + String.raw`\end{baeksingroup}\end{document}`;
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');

      // When: the real renderer compiles the table and following paragraph.
      expect(await compilePdf(directory)).toBe(1);
      const python = await inspectionPython(directory);
      const inspected = await runPdfProcess(python, ['-c', inspectSpacing, path.join(directory, 'build', 'main.pdf')], directory, 30_000);
      const geometry = InspectionSchema.parse(JSON.parse(inspected.stdout));
      const evidenceRoot = process.env['SOLUTION_LAB_PDF_SPACING_EVIDENCE'];
      if (evidenceRoot) {
        const evidenceDirectory = path.join(evidenceRoot, path.basename(directory));
        await cp(directory, evidenceDirectory, { recursive: true });
        await writeFile(path.join(evidenceDirectory, 'inspection.json'), JSON.stringify({ question, ...geometry }, null, 2), 'utf8');
      }

      // Then: fraction glyphs clear both the next row and prose at the same body size.
      expect(geometry.afterGap).toBeGreaterThanOrEqual(8);
      expect(geometry.rowGap).toBeGreaterThanOrEqual(8);
      expect(geometry.bodySizes.every(size => Math.abs(size - 11.2) < .02)).toBe(true);
      expect(geometry.text).not.toMatch(/\\(?:frac|lim|displaystyle)/u);
      expect(geometry.text).toContain('FirstRowMarker');
      expect(geometry.text).toContain('SecondRowMarker');
      expect(step).toStrictEqual(original);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-table-spacing-')) throw new Error('Unexpected table test directory');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);
});
