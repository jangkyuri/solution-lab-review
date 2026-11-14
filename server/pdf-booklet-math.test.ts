import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { displayBookletMath } from './pdf-booklet-extras.ts';
import { measuredBookletMath, splitBookletMath } from './pdf-booklet-math.ts';
import { compilePdf } from './pdf-runtime.ts';
import { renderPdfTex } from './pdf-template.ts';
import { buildJobPdf } from './pdf.ts';

const longMath = String.raw`(x^3-3x)'=3x^2-3=3(x-1)(x+1),\quad (x^3-3x+k)'=3x^2-3+0;\quad (-1,2)\to(-1,k+2),\quad (1,-2)\to(1,k-2)`;
const relationChains = [
  String.raw`(k+12)^2-4\cdot4\cdot4k<0 \quad\Longleftrightarrow\quad k^2-40k+144=(k-4)(k-36)<0 \quad\Longleftrightarrow\quad 4<k<36 \qquad k=5,6,\ldots,35,\qquad 35-5+1=31`,
  String.raw`a^2-3\left(a+\frac{10}{3}\right)\le0 \quad\Longleftrightarrow\quad (a-5)(a+2)\le0 \quad\Longleftrightarrow\quad -2\le a\le5 \qquad \frac43\le b\le\frac{25}{3} \qquad b=2,3,4,5,6,7,8,\qquad 8-2+1=7`,
];
function fixture(latex: string) {
  return JobSchema.parse({ ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN,
    teacherText: '극점의 높이를 평행이동한다.', result: { summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: '함수의 그래프를 평행이동할 때 극점을 비교한다.', firstDecision: '',
      variables: ['x', 'k'], observedOrder: [], answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
      steps: [{ id: 'S01', after: [], branch: null, title: '', originalStep: '', explanation: '극점의 가로좌표는 그대로이고 높이만 바뀐다.',
        evidence: '', latex, graph: null, booklet: { group: 'C' } }],
    }] } });
}
async function clean(directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-math-wrap-')) throw new Error('Unexpected math-wrap test directory');
  await rm(resolved, { recursive: true, force: true });
}

describe('width-aware normal booklet mathematics', () => {
  it('prints antiderivative evaluation with square brackets in the solution', () => {
    const previousNotation = String.raw`\left.\frac{x^3}{3}\right|_{0}^{2}`;
    const bracketNotation = String.raw`\left[\frac{x^3}{3}\right]_{0}^{2}`;
    const job = fixture(previousNotation + String.raw`=\frac{8}{3}`);
    const rendered = renderPdfTex(job, [], new Map());

    expect(rendered).toContain(bracketNotation);
    expect(rendered).not.toContain(previousNotation);
  });

  it('separates top-level clauses without changing equality chains or source bytes', () => {
    const parts = splitBookletMath(longMath);
    expect(parts).toHaveLength(4);
    expect(parts.join('')).toBe(longMath);
    expect(parts[0]).toBe(String.raw`(x^3-3x)'=3x^2-3=3(x-1)(x+1),`);
    expect(parts[2]).toContain(String.raw`(-1,2)\to(-1,k+2),`);
  });

  it.each([
    String.raw`f(x,\quad y),\quad g(x)`,
    String.raw`\frac{a,\quad b}{c;d},\quad z`,
    String.raw`\left\{x,\quad y\right\},\quad z`,
    String.raw`\left.x\right|_{0}^{1};\quad z`,
    String.raw`\begin{aligned}x&=1,\quad y&=2\\z&=3;\quad t&=4\end{aligned},\quad q=5`,
    String.raw`x\,y\;z,\quad q`,
    String.raw`x\leftarrow y;\quad z`,
    String.raw`|x,\quad y|,\quad z`,
    String.raw`\baeksinterm{accent}{a,\quad b}{대응 항},\quad z`,
  ])('protects nested delimiters, commands and annotations in %s', input => {
    const parts = splitBookletMath(input);
    expect(parts).toHaveLength(2);
    expect(parts.join('')).toBe(input);
  });

  it.each([String.raw`x^2=1`, String.raw`f(x,\quad y`, String.raw`\left(x;\quad y`, String.raw`\begin{aligned}x,\quad y`, String.raw`x;`])('retains an unsplittable or incomplete expression %s', input => {
    expect(splitBookletMath(input)).toEqual([input]);
  });

  it('keeps short displays unchanged and preserves whole annotated terms in measured displays', () => {
    expect(displayBookletMath('x^2=1', [])).toBe(String.raw`\[\displaystyle x^2=1\]`);
    const term = String.raw`(-1,2)\to(-1,k+2)`;
    const rendered = displayBookletMath(longMath, [{ term, note: '극점의 이동', color: 'blue' }]);
    expect(rendered).toContain(String.raw`\baeksinmeasuredmath{`);
    expect(rendered).toContain(String.raw`\baeksinterm{accent}{` + term + '}{극점의 이동}');
    expect(rendered.split(term)).toHaveLength(2);
    expect(rendered.indexOf("(x^3-3x)'=")).toBeLessThan(rendered.indexOf(term));
  });

  it('adds clause boundaries at logical relations and large gaps while preserving all source bytes', () => {
    // Given nested relations and an ordinary equality chain beside top-level logical clauses.
    const value = String.raw`\frac{a\Longrightarrow b}{c}=d=e \quad\Longleftrightarrow\quad d=e \qquad k=5,6,7`;
    // When potential line breaks are identified.
    const parts = splitBookletMath(value);
    // Then only complete top-level clauses move to new lines if the full display does not fit.
    expect(parts).toHaveLength(3);
    expect(parts.join('')).toBe(value);
    expect(parts[0]).toBe(String.raw`\frac{a\Longrightarrow b}{c}=d=e`);
    expect(parts[1]?.trim()).toBe(String.raw`\quad\Longleftrightarrow\quad d=e`);
  });

  it('keeps control-space commands whole beside a logical line break', () => {
    const value = String.raw`6=-2+a\ \Rightarrow\ a=8`;
    const parts = splitBookletMath(value);
    expect(parts).toEqual(['6=-2+a', String.raw`\ \Rightarrow\ a=8`]);
    expect(parts.join('')).toBe(value);
    expect(measuredBookletMath(value)).toContain(String.raw`\baeksinmathbreak{\ }\Rightarrow\ a=8`);
  });

  it.each([String.raw`\boxed\Rightarrow b`, String.raw`x^\Rightarrow b`, String.raw`x_\Rightarrow b`])('keeps an unbraced command or script argument intact (%s)', (value) => {
    expect(splitBookletMath(value)).toEqual([value]);
    expect(measuredBookletMath(value)).toBe(String.raw`\[\displaystyle ${value}\]`);
  });

  it.each([String.raw`\frac1\Rightarrow b`, String.raw`\frac{1}\Rightarrow b`, String.raw`\sqrt[3]\Rightarrow b`])('keeps complete command arguments before the next independent clause (%s)', (clause) => {
    const value = clause + String.raw`\qquad c=1`;
    expect(splitBookletMath(value)).toEqual([clause, String.raw`\qquad c=1`]);
  });

  it('retains break opportunities after Greek symbol operands', () => {
    const value = String.raw`\alpha\quad\Longrightarrow\quad\beta\qquad\gamma`;
    expect(splitBookletMath(value)).toEqual([String.raw`\alpha`, String.raw`\quad\Longrightarrow\quad\beta`, String.raw`\qquad\gamma`]);
  });

  it('distinguishes a derivative evaluation bar from paired absolute-value delimiters', () => {
    const value = String.raw`y'=3ax^2+b,\qquad y'\big|_{x=1}=3a+b \qquad y=(3a+b)(x-1)+6`;
    const parts = splitBookletMath(value);
    expect(parts).toHaveLength(3);
    expect(parts.join('')).toBe(value);
    expect(parts[1]).toContain(String.raw`y'\big|_{x=1}=3a+b`);
    expect(splitBookletMath(String.raw`|x|_{a}^{b},\quad q=1`)).toHaveLength(2);
  });

  it('does not move a spacing token that is itself a script argument across a clause boundary', () => {
    const value = String.raw`x^\ \Rightarrow b`;
    expect(splitBookletMath(value)).toEqual([String.raw`x^\ `, String.raw`\Rightarrow b`]);
    expect(splitBookletMath(value).join('')).toBe(value);
  });

  it('does not activate commands that fail the existing mathematical safety boundary', () => {
    const rendered = displayBookletMath(String.raw`x=1;\quad \input{private}`, []);
    expect(rendered).not.toContain(String.raw`\input{private}`);
    expect(rendered).not.toContain(String.raw`\baeksinmeasuredmath`);
    expect(rendered).toContain(String.raw`\textbackslash{}input`);
  });

  it('compiles the previously overfull display without changing the job or body font', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-math-wrap-'));
    try {
      const job = fixture(longMath);
      const original = structuredClone(job);
      const output = await buildJobPdf(job, [], directory);
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(output.pageCount).toBe(2);
      expect(renderPdfTex(job, [], new Map())).toContain(String.raw`\fontsize{11.2bp}{18.2bp}\selectfont`);
      expect(job).toStrictEqual(original);
    } finally { await clean(directory); }
  }, 120_000);

  it.each(relationChains)('wraps a wide logical chain at full font size without a comparison table (%s)', async (latex) => {
    // Given an exact relation chain from the failed production export, without its nearby table.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-math-wrap-'));
    const job = fixture(latex);
    const before = structuredClone(job);
    try {
      // When the ordinary PDF exporter compiles this generated expression.
      const output = await buildJobPdf(job, [], directory);
      // Then no overfull warning is accepted, and no source or body font is changed.
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(renderPdfTex(job, [], new Map())).toContain(String.raw`\fontsize{11.2bp}{18.2bp}\selectfont`);
      expect(job).toStrictEqual(before);
    } finally { await clean(directory); }
  }, 120_000);

  it('preserves the exact native display dimensions when all clauses fit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-math-wrap-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const short = String.raw`f(x)=x^2,\quad g(x)=x+1`;
      const preamble = renderPdfTex(fixture(''), [], new Map()).split(String.raw`\begin{document}`)[0] ?? '';
      const tex = preamble + String.raw`\begin{document}
\fontsize{11.2bp}{18.2bp}\selectfont
\newbox\actualdisplay\newbox\expecteddisplay
\setbox\actualdisplay=\vbox{\hsize=400bp\linewidth=400bp ` + measuredBookletMath(short) + String.raw`}
\setbox\expecteddisplay=\vbox{\hsize=400bp\linewidth=400bp \[\displaystyle ` + short + String.raw`\]}
\ifdim\ht\actualdisplay=\ht\expecteddisplay\else\PackageError{wraptest}{Fitting display height changed}{}\fi
\ifdim\dp\actualdisplay=\dp\expecteddisplay\else\PackageError{wraptest}{Fitting display depth changed}{}\fi
\usebox\actualdisplay\end{document}`;
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');
      expect(await compilePdf(directory)).toBe(1);
    } finally { await clean(directory); }
  }, 120_000);
});
