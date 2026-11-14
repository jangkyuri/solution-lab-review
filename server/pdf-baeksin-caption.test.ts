import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN, LEGACY_PDF_DESIGN } from '../shared/pdf-design.ts';
import type { PdfDesign } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { renderPdfTex } from './pdf-template.ts';

const explanation = '같은 점을 두 번 세지 않는다.';
const uniqueCaption = String.raw`그래프에서 \(\frac{2}{3}\)의 위치를 읽는다.`;
function fixture(body: string, caption = uniqueCaption, support: 'none' | 'note' | 'takeaway' = 'none', design: PdfDesign = BAEKSIN_V16_PDF_DESIGN) {
  return JobSchema.parse({ ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: design,
    teacherText: '서로 다른 점을 센다.', result: { summary: '', references: [], limitations: [], questions: [{
      number: '1', problemText: '서로 다른 교점의 개수를 구하여라.', firstDecision: '', variables: ['x'], observedOrder: [],
      answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] }, steps: [{
        id: 'S01', after: [], branch: null, title: '', originalStep: '', evidence: '', latex: 'x^2=1', explanation: body,
        graph: { title: '', xMin: -2, xMax: 2, yMin: -1, yMax: 2, xLabel: 'x', yLabel: 'y', curves: [], points: [], verticals: [], explanation: caption },
        booklet: { group: 'A', keyPhrases: [explanation], ...(support === 'note' ? { equationNote: '교점의 개수를 확인한다.' }
          : support === 'takeaway' ? { takeaway: '서로 다른 점만 센다.' } : {}) },
      }],
    }] } });
}
function body(job: ReturnType<typeof fixture>, graph = true) {
  return renderPdfTex(job, [], graph ? new Map([['0-0', 'graph.pdf']]) : new Map()).split(String.raw`\begin{document}`)[1] ?? '';
}

describe('Baeksin exact repeated graph explanations', () => {
  it.each([
    { prose: '먼저 교점을 센다. 같은 점을 두 번 세지 않는다. 끝점도 확인한다.', caption: explanation },
    { prose: '먼저 교점을 센다. 같은 점을 두 번 세지 않는다. 끝점도 확인한다.', caption: '같은 점을 두 번 세지 않는다. 끝점도 확인한다.' },
    { prose: '같은 점을  두 번\n세지 않는다.', caption: explanation },
  ])('omits only an identical complete sentence block after whitespace normalization', ({ prose, caption }) => {
    const job = fixture(prose, caption);
    const original = structuredClone(job);
    const tex = body(job);
    expect(tex.match(/같은 점을/gu) ?? []).toHaveLength(1);
    if (prose.includes(explanation)) expect(tex).toContain(String.raw`\baeksinhighlight{`);
    expect(tex).toContain(String.raw`\[\displaystyle x^2=1\]`);
    expect(job).toStrictEqual(original);
  });

  it.each([
    { prose: explanation, caption: '끝점에서는 접하는 점을 한 번 세므로 경우를 따로 확인한다.' },
    { prose: explanation, caption: explanation + ' 다만 끝점에서는 두 식이 같아지는지 먼저 확인해야 한다.' },
    { prose: '두 교점 가운데 같은 점을 두 번 세지 않는다.', caption: explanation },
    { prose: '높이는 2.5이다.', caption: '5이다.' },
    { prose: '먼저 같은 점을 센다. 다음 조건을 확인한다.', caption: '먼저 같은 점을 센다' },
  ])('preserves unique proof, mixed captions, partial sentences and numeric fragments', ({ prose, caption }) => {
    const job = fixture(prose, caption);
    const original = structuredClone(job);
    expect(body(job)).toContain(caption);
    expect(job).toStrictEqual(original);
  });

  it.each(['', '  \n '])('retains readable graph-only fallback when body prose is empty (%j)', text => {
    const job = fixture(text);
    expect(body(job)).toContain(String.raw`그래프에서 \(\displaystyle \frac{2}{3}\)의 위치를 읽는다.`);
  });

  it.each(['note', 'takeaway'] as const)('keeps the existing support explanation guard (%s)', support => {
    const tex = body(fixture('', uniqueCaption, support));
    expect(tex).not.toContain('그래프에서');
    expect(tex).toContain(support === 'note' ? '교점의 개수를 확인한다.' : '서로 다른 점만 센다.');
  });

  it('does not add fallback text without a staged graph', () => {
    expect(body(fixture(''), false)).not.toContain('그래프에서');
  });

  it('leaves the standard template body and repeated caption unchanged', () => {
    const job = fixture(explanation, explanation, 'none', LEGACY_PDF_DESIGN);
    const original = structuredClone(job);
    expect(body(job).match(/같은 점을 두 번 세지 않는다\./gu) ?? []).toHaveLength(2);
    expect(job).toStrictEqual(original);
  });
});
