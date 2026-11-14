import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { buildJobPdf } from './pdf.ts';
import { renderPdfTex } from './pdf-template.ts';
import { compilePdf } from './pdf-runtime.ts';

const keyMath = String.raw`g(t)=\sqrt{t^2+(f(t)-tf^{\prime}(t))^2}`;
const keyPhrase = String.raw`원점에서 \(P\)까지의 거리`;
const longKeyMath = String.raw`a-1<4a-8\ \Rightarrow\ a>\frac73,\qquad 9a-27<4a-8\ \Rightarrow\ a<\frac{19}{5}\qquad \frac73<a<\frac{19}{5},\quad a\text{는 자연수}\ \Rightarrow\ a=3\qquad b>2,\quad b<4,\quad b>0,\quad b\text{는 자연수}\ \Rightarrow\ b=3\qquad f(x)=x^3-3x^2+3,\qquad f(1)=1-3+3=1`;
function fixture(explanation: string, keyPhrases: readonly string[], key = false, takeaway = '') {
  return JobSchema.parse({
    ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN,
    teacherText: '거리를 구한 다음 구간에서 비교한다.',
    result: {
      summary: '', references: [], limitations: [],
      questions: [{
        number: '1', problemText: '접선의 절편까지의 거리를 구하여라.', firstDecision: '', variables: ['t', 'f', 'g'],
        observedOrder: [], answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
        steps: [{ id: 'S01', after: [], branch: null, title: '', explanation, latex: keyMath,
          originalStep: '', evidence: '', graph: null,
          booklet: { group: 'A', equationRole: key ? 'key' : 'normal', keyPhrases, takeaway,
            equationNote: '가로 길이와 세로 길이를 거리 공식에 대입한다.',
            termNotes: [{ term: 't^2', note: '가로 길이의 제곱', color: 'blue' }] },
        }],
      }],
    },
  });
}

function body(job: ReturnType<typeof fixture>): string {
  return renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
}

describe('Baeksin mathematical emphasis', () => {
  it.each([
    { symbol: 'f', before: true }, { symbol: 'g', before: false },
  ])('places a leading source definition before its coefficient explanation ($symbol)', ({ symbol, before }) => {
    const explanation = '계수를 차례로 비교한다.';
    const job = fixture(explanation, []);
    const question = job.result?.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing definition-order fixture');
    question.problemText = String.raw`함수 \(f(x)=x^3-2x^2+5x+3\)의 접선을 구하여라.`;
    step.latex = symbol + String.raw`(x)=ax^4+bx^3+cx^2+dx+e,\quad f(t)-tf^{\prime}(t)=-3at^4-2bt^3-ct^2+e`;
    if (step.booklet) { delete step.booklet.equationNote; delete step.booklet.termNotes; }
    const original = structuredClone(job);

    const group = body(job).split(String.raw`\begin{baeksingroup}{A}`)[1] ?? '';

    const definition = group.indexOf(symbol + '(x)=');
    const prose = group.indexOf(explanation);
    expect(definition).toBeGreaterThanOrEqual(0);
    expect(prose).toBeGreaterThanOrEqual(0);
    expect(definition < prose).toBe(before);
    expect(group.split(symbol + '(x)=').length - 1).toBe(1);
    expect(job).toStrictEqual(original);
  });


  it('renders one full-width key equation with its term note and small support note', () => {
    const tex = body(fixture('두 길이를 거리 공식에 넣는다.', [], true));

    expect(tex.match(/\\baeksinkeymath\{/gu) ?? []).toHaveLength(1);
    expect(tex.match(/\\baeksinterm\{/gu) ?? []).toHaveLength(1);
    expect(tex).toContain(String.raw`\baeksinlabel{가로 길이와 세로 길이를 거리 공식에 대입한다.}`);
    expect(tex).not.toContain(String.raw`\baeksinequation{`);
  });

  it('highlights exact prose and takeaway spans while retaining complete inline mathematics', () => {
    const tex = body(fixture(keyPhrase + '를 구한다.', [keyPhrase, '최댓값을 비교한다.'], false, '최댓값을 비교한다.'));

    expect(tex).toContain(String.raw`\baeksinhighlight{` + keyPhrase + '}');
    expect(tex).toContain(String.raw`\baeksinhighlight{최댓값을 비교한다.}`);
    expect(tex.match(/\\baeksinhighlight\{/gu) ?? []).toHaveLength(2);
  });

  it.each([
    { text: keyPhrase, phrases: ['P'] },
    { text: String.raw`값은 \(\frac{1}{2}\)이다.`, phrases: [String.raw`\frac`] },
    { text: '거리를 구한다.', phrases: ['없는 구절'] },
    { text: '값이 같다. 기울기도 같다.', phrases: ['같다'] },
    { text: String.raw`값은 \(\input{private}\)이다.`, phrases: [String.raw`\(\input{private}\)`] },
  ])('ignores unsafe, partial, ambiguous or absent highlights in $text', ({ text, phrases }) => {
    const tex = body(fixture(text, phrases));
    expect(tex).not.toContain(String.raw`\baeksinhighlight{`);
  });

  it('applies overlapping emphasis once to the complete span', () => {
    const tex = body(fixture('접선의 기울기를 읽는다.', ['접선의 기울기', '기울기']));
    expect(tex.match(/\\baeksinhighlight\{/gu) ?? []).toHaveLength(1);
    expect(tex).toContain(String.raw`\baeksinhighlight{접선의 기울기}`);
  });

  it('wraps a measured highlight after a long inline coordinate without overflowing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-emphasis-smoke-'));
    try {
      const phrase = '원점에서 P까지의 거리는 그 높이의 절댓값이다.';
      const text = String.raw`점 P는 y축 위에 있으므로 좌표는 \((0,-2t^3+2t^2+3)\)이다. 따라서 ` + phrase;
      const job = fixture(text, [phrase], true);
      const booklet = job.result?.questions[0]?.steps[0]?.booklet;
      if (booklet) { delete booklet.equationNote; delete booklet.termNotes; }
      const output = await buildJobPdf(job, [], directory);
      expect(output.pageCount).toBe(2);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-emphasis-smoke-')) {
        throw new Error('Unexpected emphasis test directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    { label: 'production source', latex: longKeyMath },
    { label: 'math-only boundary spacing', latex: longKeyMath.replaceAll(String.raw`\qquad`, String.raw`\qquad\;\:\!`) },
  ])('keeps whole inequalities and evaluations on one line within a wide key equation ($label)', async ({ latex }) => {
    // Given the exact key equation whose ordinary inline wrapping split b>0 and f(1)=its value.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-emphasis-smoke-'));
    const job = fixture('', [], true);
    const step = job.result?.questions[0]?.steps[0];
    if (!step?.booklet) throw new Error('Missing key-equation fixture');
    step.latex = latex;
    delete step.booklet.equationNote;
    delete step.booklet.termNotes;
    const before = structuredClone(job);
    try {
      await mkdir(path.join(directory, 'build'));
      let tex = renderPdfTex(job, [], new Map());
      tex = tex.replace(String.raw`\begin{document}`, String.raw`\begin{document}
\newwrite\keypositions\immediate\openout\keypositions=key-positions.txt
\newcommand{\keyposition}[1]{\pdfsavepos\write\keypositions{#1:\thepage:\the\pdflastypos}}`);
      tex = tex.replaceAll('b>0', String.raw`\keyposition{b-start}b>0\keyposition{b-end}`);
      tex = tex.replaceAll('f(1)=1-3+3=1', String.raw`\keyposition{f-start}f(1)=1-3+3=1\keyposition{f-end}`);
      tex = tex.replace(String.raw`\end{document}`, String.raw`\clearpage\immediate\closeout\keypositions\end{document}`);
      await writeFile(path.join(directory, 'main.tex'), tex, 'utf8');
      // When the real key-equation paragraph is typeset and its positions are recorded.
      await compilePdf(directory);
      const positions = new Map<string, string>();
      for (const line of (await readFile(path.join(directory, 'build/key-positions.txt'), 'utf8')).trim().split(/\r?\n/u)) {
        const [name, page, y] = line.split(':');
        if (!name || !page || !y) throw new Error('Missing key-equation position');
        positions.set(name, page + ':' + y);
      }
      // Then each complete relation has one baseline, at the original large type size.
      expect(positions.get('b-start')).toBe(positions.get('b-end'));
      expect(positions.get('f-start')).toBe(positions.get('f-end'));
      expect(tex).not.toContain(String.raw`\fontsize{17bp}{23bp}`);
      expect(job).toStrictEqual(before);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-emphasis-smoke-')) throw new Error('Unexpected emphasis test directory');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([false, true])('compiles normal and key hierarchy with inline emphasis (key=%s)', async key => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-emphasis-smoke-'));
    try {
      const job = fixture(keyPhrase + '를 구한다.', [keyPhrase], key);
      const output = await buildJobPdf(job, [], directory);
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(output.pageCount).toBe(2);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-emphasis-smoke-')) {
        throw new Error('Unexpected emphasis test directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);
});
