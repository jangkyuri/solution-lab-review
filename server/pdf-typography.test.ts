import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN, LEGACY_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { formatBookletProse } from './pdf-booklet-emphasis.ts';
import { formatBookletTableCell } from './pdf-booklet-table.ts';
import { formatInlineTex } from './pdf-safety.ts';
import { renderPdfTex } from './pdf-template.ts';
import { buildJobPdf } from './pdf.ts';

const fraction = String.raw`\frac{89}{27}`;
const explanation = String.raw`거리 후보 \(\frac{89}{27}\)을 끝점의 값과 비교한다.`;
function fixture(baeksin = true) {
  return JobSchema.parse({
    ...jobFixture, mode: 'supplement', status: 'ready',
    pdfDesign: baeksin ? BAEKSIN_V16_PDF_DESIGN : LEGACY_PDF_DESIGN,
    teacherText: '끝점과 내부 후보를 비교한다.',
    result: { summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: String.raw`구간 \(0\le t\le\frac{2}{3}\)에서 최댓값을 구하여라.`,
      firstDecision: '', variables: ['t'], observedOrder: [], answer: String.raw`\(\frac{89}{27}\)`,
      uncertainties: [], checks: { math: [], sequence: [], graph: [] },
      steps: [{ id: 'S01', after: [], branch: null, title: '', originalStep: '', evidence: '', explanation,
        latex: '', graph: { title: '', xMin: 0, xMax: 1, yMin: 0, yMax: 1, xLabel: 't', yLabel: 'y',
          curves: [], points: [], verticals: [], explanation: String.raw`그림에서 \(\frac{2}{3}\)의 위치를 읽는다.` },
        booklet: { group: 'A' },
      }, { id: 'S02', after: ['S01'], branch: null, title: '', originalStep: '', evidence: '',
        explanation: '같은 위치의 값을 표에서 비교한다.', latex: '', graph: null,
        booklet: { group: 'B', table: [['비교할 위치', '거릿값'], ['내부 후보 t=2/3', '89/27'], ['오른쪽 끝', '5']] },
      }],
    }] },
  });
}

function body(baeksin = true, asset = 'graph.pdf') {
  return renderPdfTex(fixture(baeksin), [], new Map([['0-0', asset]])).split(String.raw`\begin{document}`)[1] ?? '';
}

describe('Baeksin readable typography', () => {
  it('enlarges safe fractional inline math in prose, recap, answer and table without changing data', () => {
    // Given: the saved mathematical content contains ordinary inline fractions.
    const job = fixture();
    const original = structuredClone(job);
    // When: the Baeksin student pages are rendered.
    const tex = renderPdfTex(job, [], new Map([['0-0', 'graph.pdf']]));
    // Then: fraction digits use the local readable style, while the stored strings stay intact.
    expect(tex).toContain(String.raw`\(\displaystyle ` + fraction + String.raw`\)`);
    expect(tex).toContain(String.raw`\(\displaystyle 0\le t\le\frac{2}{3}\)`);
    expect(tex).toContain(String.raw`그림에서 \(\displaystyle \frac{2}{3}\)의 위치를 읽는다.`);
    expect(formatBookletTableCell('89/27')).toBe(String.raw`\(\displaystyle \frac{89}{27}\)`);
    expect(job).toStrictEqual(original);
  });

  it('keeps default inline formatting and the plain template unchanged', () => {
    const inline = String.raw`값은 \(\frac{2}{3}+x\)이다.`;
    expect(formatInlineTex(inline)).toBe(inline);
    expect(body(false)).toContain(String.raw`\(\frac{89}{27}\)`);
    expect(body(false)).not.toContain(String.raw`\(\displaystyle \frac{89}{27}\)`);
    expect(formatBookletTableCell(String.raw`\(\dfrac{2}{3}\)`)).toBe(String.raw`\(\dfrac{2}{3}\)`);
    expect(formatBookletTableCell(String.raw`\(\tfrac{2}{3}\)`)).toBe(String.raw`\(\tfrac{2}{3}\)`);
    expect(formatBookletProse(String.raw`\(\frac{1}{2}+\input{secret}\)`)).not.toContain(String.raw`\input{secret}`);
  });

  it.each([{ phrases: [] }, { phrases: ['끝점의 값'] }])('uses scoped ragged-right prose with phrases $phrases', ({ phrases }) => {
    const output = formatBookletProse(explanation, phrases);
    expect(output).toMatch(/^\\begingroup\\raggedright(?:\\lineskiplimit=2\.5bp\\lineskip=3bp)? /u);
    expect(output).toMatch(/\\par\\endgroup$/u);
    expect(body()).toContain(String.raw`\begingroup\raggedright\lineskiplimit=2.5bp\lineskip=3bp 그림에서`);
  });

  it('uses canonical collision guards only for Baeksin and gives fractional table rows clearance', () => {
    const tex = renderPdfTex(fixture(), [], new Map());
    expect(tex).toContain(String.raw`\lineskiplimit=2.5bp`);
    expect(tex).toContain(String.raw`\lineskip=3bp`);
    expect(tex).toContain(String.raw`\rule[-9bp]{0pt}{26bp}`);
    expect(renderPdfTex(fixture(false), [], new Map())).not.toContain(String.raw`\lineskiplimit=2.5bp`);
    expect(tex).toContain(String.raw`\fontsize{11.2bp}{18.2bp}\selectfont`);
    expect(tex).not.toContain(String.raw`\everymath`);
  });

  it('includes native staged TeX graphs without scaling their fonts', () => {
    const tex = body(true, 'graph-0-0.tex');
    expect(tex).toContain(String.raw`\input{graph-0-0.tex}`);
    expect(tex).not.toMatch(/\\includegraphics\[[^\]]*\]\{graph-0-0\.tex\}/u);
    expect(tex).not.toContain(String.raw`\resizebox`);
  });

  it('compiles readable fractions in prose and comparison rows with the collision guard active', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-typography-smoke-'));
    try {
      const job = fixture();
      for (const question of job.result?.questions ?? []) for (const step of question.steps) step.graph = null;
      const tex = renderPdfTex(job, [], new Map());
      expect(tex).toContain(String.raw`\(\displaystyle ` + fraction + String.raw`\)`);
      const output = await buildJobPdf(job, [], directory);
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(output.pageCount).toBe(2);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-typography-smoke-')) throw new Error('Unexpected typography smoke directory');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);
});
