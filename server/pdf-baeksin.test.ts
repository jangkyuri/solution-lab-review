import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { renderPdfTex } from './pdf-template.ts';
import { buildJobPdf } from './pdf.ts';
import type { PdfAsset } from './pdf-template.ts';

const problemText = '접선의 기울기가 4일 때 그 점에서의 미분계수를 구하여라.';
const sourceCases: readonly { readonly source: string; readonly assets: readonly PdfAsset[] }[] = [
  { source: 'typed original', assets: [] },
  { source: 'combined image', assets: [{ localName: 'source.png', name: '원본', mimeType: 'image/png', role: 'exam_and_handwriting', sourceFileIds: ['exam'] }] },
  { source: 'combined PDF', assets: [{ localName: 'source.pdf', name: '원본', mimeType: 'application/pdf', role: 'exam_and_handwriting', sourceFileIds: ['exam'] }] },
];
const missingMarkers = ['', '미확인', '미상', '없음', 'unknown', 'unnumbered', ' UNKNOWN ', '미확인-1', '미확인-2'];

function fixture(number: string, wideFirst = false) {
  return JobSchema.parse({
    ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN, teacherText: '미분계수의 정의를 쓴다.',
    result: {
      summary: '', references: [], limitations: [],
      questions: [{
        number, problemText, firstDecision: '', variables: ['x'], observedOrder: [],
        steps: wideFirst ? [{
          id: 'S01', after: [], branch: null, title: '수식의 항을 비교한다.', originalStep: '', evidence: '', graph: null,
          explanation: '각 항을 미분한 결과를 원래 식에서 뺀다.',
          latex: String.raw`f(t)-t(4at^3+3bt^2+2ct+d)=-3at^4-2bt^3-ct^2+e`,
          booklet: { group: 'F', equationNote: '각 항의 차이를 같은 순서로 확인한다.' },
        }, {
          id: 'S02', after: ['S01'], branch: null, title: '본문으로 시작한다.', originalStep: '', evidence: '', graph: null,
          explanation: '상수항은 원래 식에서 뺄 항이 없어 그대로 남는다.', latex: '', booklet: { group: 'G' },
        }] : [],
        answer: '4', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
      }],
    },
  });
}

describe('Baeksin student question markers', () => {
  it('keeps distinct unnamed identifiers in data while omitting both student markers', () => {
    const base = fixture('미확인-1');
    const first = base.result?.questions[0];
    if (!first) throw new Error('Missing marker fixture question');
    const job = JobSchema.parse({ ...base, result: { ...base.result, questions: [first, { ...first, number: '미확인-2' }] } });
    const original = structuredClone(job);

    const body = renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body.match(/\\baeksinrecap\{\}/gu) ?? []).toHaveLength(2);
    expect(body).not.toContain('미확인');
    expect(job).toStrictEqual(original);
  });

  it.each(['text', 'table', 'no-steps'] as const)('labels the final answer as its own paragraph for %s', (layout) => {
    const base = fixture('5', layout !== 'no-steps');
    const graph = { title: '', xMin: 0, xMax: 1, yMin: 0, yMax: 1, xLabel: 'x', yLabel: 'y',
      curves: [], points: [], verticals: [], explanation: '' };
    const questions = base.result?.questions.map(question => ({ ...question, answer: '5',
      steps: question.steps.map((step, index) => layout === 'table' && index === 1
        ? { ...step, graph, booklet: { ...step.booklet, table: [['대상', '결과'], ['상수항', '5']] } } : step),
    }));
    const job = JobSchema.parse({ ...base, result: { ...base.result, questions } });

    const body = renderPdfTex(job, [], new Map([['0-1', 'table-graph.pdf']])).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toContain(String.raw`\raggedleft\color{black}\noindent\textbf{정답}\enspace 5\par`);
    expect(body.match(/\\textbf\{정답\}/gu) ?? []).toHaveLength(1);
  });

  it('keeps inline mathematics inside the separately labelled answer', () => {
    const base = fixture('5');
    const answer = String.raw`\(f(t)-t(4at^3+3bt^2+2ct+d)=-3at^4-2bt^3-ct^2+e\)`;
    const job = JobSchema.parse({ ...base, result: { ...base.result,
      questions: base.result?.questions.map(question => ({ ...question, answer })),
    } });

    const body = renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toContain(String.raw`\textbf{정답}\enspace ` + answer + String.raw`\par`);
  });


  it('anchors the margin marker before a centered first equation without adding a text paragraph', () => {
    // Given: the first visual is a formula wider than the side-annotation column.
    const job = fixture('5', true);
    // When: its preamble and student page are rendered.
    const tex = renderPdfTex(job, [], new Map());
    // Then: the list item enters horizontal mode before any centered layout changes alignment.
    expect(tex.split(String.raw`\begin{document}`)[1] ?? '').toMatch(/\\begin\{baeksingroup\}\{F\}\s*\\baeksinstart\s*\\baeksinequation/u);
    expect(tex).toContain(String.raw`\baeksinequation{\(\displaystyle f(t)-t(4at^3+3bt^2+2ct+d)=-3at^4-2bt^3-ct^2+e\)}`);
  });


  it.each(['미확인', '5'])('compiles the actual student headers for marker "%s"', async (number) => {
    // Given: a real XeLaTeX run for either an absent or supplied marker.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-header-smoke-'));
    const job = fixture(number, true);
    try {
      // When: XeLaTeX compiles the actual two student pages.
      const output = await buildJobPdf(job, [], directory);

      // Then: the real PDF is valid, and its input has the complete problem and correct marker.
      expect((await readFile(output.path)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(output.pageCount).toBe(2);
      const marker = number === '5' ? '5' : '';
      expect(renderPdfTex(job, [], new Map())).toContain(`\\baeksinrecap{${marker}}{${problemText}}`);
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-header-smoke-')) {
        throw new Error('Unexpected header smoke test directory');
      }
      await rm(resolved, { recursive: true, force: true });
    }
  }, 120_000);


  it.each(missingMarkers.flatMap(number => sourceCases.map(source => ({ number, ...source }))))(
    'omits the missing marker "$number" for $source while retaining the full problem',
    ({ number, assets }) => {
      // Given: the source does not supply a printed question number.
      const job = fixture(number);
      const original = structuredClone(job);
      // When: the original and supplement are rendered.
      const body = renderPdfTex(job, assets, new Map()).split(String.raw`\begin{document}`)[1] ?? '';
      // Then: both student headers have no fabricated marker and the source remains unchanged.
      expect(body).toContain(String.raw`\baeksinrecap{}{` + problemText + '}');
      if (assets[0]?.mimeType === 'application/pdf') {
        expect(body).toContain(String.raw`\baeksinrunning{문제·손풀이}`);
      } else {
        expect(body).toContain(String.raw`\baeksinsourcepage{문제·손풀이}`);
      }
      expect(body).not.toContain(String.raw`\textbf{.}`);
      expect(body).not.toMatch(/미확인번|미상번|없음번|unknown번|unnumbered번/iu);
      expect(job).toStrictEqual(original);
    },
  );

  it.each([
    { number: '1', marker: '1' }, { number: '01', marker: '01' },
    { number: 'A-3', marker: 'A-3' }, { number: '문항 가', marker: '문항 가' },
    { number: 'Q_3', marker: String.raw`Q\_3` },
  ])('preserves the supplied marker "$number"', ({ number, marker }) => {
    // Given: a real source-specified question marker.
    const job = fixture(number);
    const original = structuredClone(job);
    // When: the student pages are rendered.
    const body = renderPdfTex(job, sourceCases[1]?.assets ?? [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
    // Then: source and supplement keep that exact marker.
    expect(body).toContain(`\\baeksinsourcepage{${marker}번 · 문제·손풀이}`);
    expect(body).toContain(`\\baeksinrecap{${marker}}{${problemText}}`);
    expect(job).toStrictEqual(original);
  });
});
