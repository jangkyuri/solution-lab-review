import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GraphSchema, JobSchema, StepBookletSchema } from '../shared/contracts.ts';
import { LEGACY_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { renderPdfTex } from './pdf-template.ts';
import type { PdfAsset } from './pdf-template.ts';
import { compilePdf, runPdfProcess } from './pdf-runtime.ts';
import { bookletNativeGraphWidth } from './pdf-booklet-graphs.ts';
import { renderBookletGraphTex } from './pdf-graph-native.ts';

function fixture() {
  return JobSchema.parse({ ...jobFixture, mode: 'supplement', status: 'ready',
    pdfDesign: { fontSize: 11, margins: 'standard', stepLayout: 'flow', template: 'baeksin-v16', sourceLayout: 'stacked-reference' },
    result: { summary: '', references: [], limitations: [], questions: [{
      number: '7', problemText: '함수의 최솟값을 구하여라.', firstDecision: '', variables: ['x'], observedOrder: [],
      steps: [{ id: 'S1', after: [], branch: null, title: '', originalStep: '', evidence: '', graph: null,
        explanation: '극값은 하나만 존재한다.', latex: 'f(1)=2', booklet: { group: 'A' } }],
      answer: '2', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
    }] },
  });
}

const combinedImage: PdfAsset = {
  localName: 'source.png', name: '문제와 손풀이', mimeType: 'image/png',
  role: 'exam_and_handwriting', sourceFileIds: ['exam', 'handwriting'],
};

describe('finished stacked reference layout', () => {
  it('prints the upper and lower halves of a matched source before its reference', () => {
    const base = fixture();
    const job = JobSchema.parse({ ...base, result: { ...base.result, productionVersion: 'hand-solution-v1' } });
    const image = { ...combinedImage, sourcePanels: ['upper.png', 'lower.png'] as const };

    const body = renderPdfTex(job, [image], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toMatch(/\\baeksinsourcepanels\{[^\n]*upper\.png[^\n]*\}\{[^\n]*lower\.png[^\n]*\}[\s\S]*손풀이 참고/u);
    expect(body).not.toContain('source.png');
  });

  it('keeps the same crop width and one continuous seam for a combined PDF source', () => {
    const base = fixture();
    const source = { ...combinedImage, localName: 'combined.pdf', mimeType: 'application/pdf',
      mappedSourceSplits: new Map([['7', { pageHeight: 792, seam: 396, ratio: 0.7 }]]) };
    const job = JobSchema.parse({ ...base,
      files: [{ id: 'exam', name: 'combined.pdf', size: 100, mimeType: 'application/pdf', role: 'exam', url: '/source' }],
      originalProblems: [{ questionNumber: '7', fileId: 'exam', page: 2, trim: [12, 80, 200, 100], widthBp: 340 }],
      result: { ...base.result, productionVersion: 'hand-solution-v1' },
    });

    const body = renderPdfTex(job, [source], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toMatch(/\\baeksinsourcepanels\{[^\n]*page=2,pagebox=cropbox,trim=12bp 396bp 200bp 100bp[^\n]*\}\{[^\n]*page=2,pagebox=cropbox,trim=12bp 80bp 200bp 396bp/u);
    expect(body.match(/ifdim185\.50bp/gu)).toHaveLength(2);
    expect(body).not.toContain('includepdf');
  });

  it('prints a student supplement in order and omits source review notes from the PDF', () => {
    const base = fixture();
    const question = base.result?.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing reference fixture');
    const conflict = String.raw`분자에 \(2\)가 쓰였는지 확인한다.`;
    const job = JobSchema.parse({ ...base, result: { ...base.result, productionVersion: 'hand-solution-v1', questions: [{ ...question,
      firstDecision: '극소점의 높이를 읽는다.', answer: String.raw`\frac{5}{2}`,
      uncertainties: [`S1 단계 원문 판독 확인이 필요합니다. ${conflict}`, '[확인 필요] 둘째 줄의 부호가 흐리다.'],
      steps: [{ ...step, title: '높이 찾기', sourceConflict: `[확인 필요] ${conflict}` },
        { ...step, id: 'S2', title: '값 대입하기', explanation: '이제 값을 대입한다.', latex: 'f(2)=3' }],
    }] } });

    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    const sections = [String.raw`\baeksinfinalsource{7}`, '손풀이 참고', String.raw`\baeksinfinalmark{A}`, '극값은 하나만 존재한다.', '이제 값을 대입한다.', '정답'];
    const offsets = sections.map(section => body.indexOf(section));
    expect(offsets.every((offset, index) => offset >= 0 && offset > (offsets[index - 1] ?? -1))).toBe(true);
    expect(body).toContain(String.raw`\(\displaystyle \frac{5}{2}\)`);
    expect(body).not.toMatch(/\[확인 필요\]|분자에|둘째 줄의 부호|S1 단계 원문 판독|정답:|핵심:|단계\./u);
  });

  it('uses the student format for a new standard solve without including the review appendix', () => {
    const base = fixture();
    const question = base.result?.questions[0];
    if (!question) throw new Error('Missing reference fixture');
    const job = JobSchema.parse({ ...base, mode: 'solve', pdfDesign: LEGACY_PDF_DESIGN, reviewNote: '교사 전용 메모',
      result: { ...base.result, productionVersion: 'hand-solution-v1', limitations: ['검토 초안 설명'], questions: [{ ...question,
        firstDecision: '극소점의 높이를 읽는다.', uncertainties: [], checks: { ...question.checks, math: ['교사 검산 기록'] },
        steps: question.steps.map(step => ({ ...step, booklet: { ...step.booklet, table: [['비교 대상', '판단 결과'], ['극소점', '최솟값']] } })),
      }] } });

    const body = renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toMatch(/문제 7[\s\S]*핵심:[\s\S]*1단계\.[\s\S]*\\raggedleft\\color\{black\}\\noindent\\textbf\{정답\}/u);
    expect(body).toMatch(/1단계\.[\s\S]*비교 대상 & 판단 결과[\s\S]*극값은 하나만 존재한다/u);
    expect(body).not.toMatch(/교사 전용 메모|검토 초안 설명|교사 검산 기록|\[확인 필요\]/u);
  });

  it('places the supporting wide graph before the prose and derived formula in the new booklet', () => {
    const base = fixture();
    const question = base.result?.questions[0];
    if (!question) throw new Error('Missing reference fixture');
    const job = JobSchema.parse({ ...base, result: { ...base.result, productionVersion: 'hand-solution-v1', questions: [{
      ...question, steps: question.steps.map(step => ({ ...step, booklet: { ...step.booklet, figure: 'wide' } })),
    }] } });

    const body = renderPdfTex(job, [combinedImage], new Map([['0-0', 'evidence.tex']])).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toMatch(/\\input\{evidence\.tex\}[\s\S]*\\baeksinfinalmark\{A\}[\s\S]*극값은 하나만 존재한다[\s\S]*f\(1\)=2/u);
    expect(body.match(/evidence\.tex/gu)).toHaveLength(1);
  });

  it('places the final step marker on the equation line when there is no prose', () => {
    const base = fixture();
    const question = base.result?.questions[0];
    if (!question) throw new Error('Missing reference fixture');
    const job = JobSchema.parse({ ...base, result: { ...base.result, productionVersion: 'hand-solution-v1', questions: [{
      ...question, steps: question.steps.map(step => ({ ...step, explanation: '' })),
    }] } });

    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toContain(String.raw`\baeksinleftmath[\baeksinfinalmark{A}]{f(1)=2}`);
  });

  it('uses only the printed number in a final single-image solve', () => {
    const base = fixture();
    const job = JobSchema.parse({ ...base, mode: 'solve', result: { ...base.result, productionVersion: 'hand-solution-v1' } });
    const source: PdfAsset = { ...combinedImage, role: 'exam', sourceFileIds: ['exam'] };
    const body = renderPdfTex(job, [source], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toContain(String.raw`\baeksinfinalsource{}{`);
    expect(body).not.toContain(String.raw`\baeksinfinalsource{7}`);
    expect(body.match(/source\.png/gu)).toHaveLength(1);
  });

  it('puts the labeled derivative before its sign table and keeps a later graph beside its table', () => {
    const base = fixture();
    const question = base.result?.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing graph fixture.');
    const job = JobSchema.parse({ ...base, result: { ...base.result, productionVersion: 'hand-solution-v1', questions: [{ ...question,
      steps: [{ ...step, explanation: '', latex: "f'(x)=3x(x-2)", booklet: { group: 'A', equationRole: 'normal',
        table: [['도함수 부호', '변화'], ['양수', '증가']] } },
      { ...step, id: 'S2', latex: String.raw`k=\pm2`, booklet: { group: 'B', equationRole: 'key', figure: 'side',
        table: [['교점 수', '값'], ['두 개', '두 값']] } }],
    }] } });
    const body = renderPdfTex(job, [combinedImage], new Map([['0-1', 'evidence.tex']])).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toMatch(/\\baeksinleftmath\[\\baeksinfinalmark\{A\}\].*f'\(x\)=3x\(x-2\)[\s\S]*도함수 부호/u);
    expect(body).toMatch(/\\begin\{baeksinside\}\{\\baeksinfinalmark\{B\}[\s\S]*교점 수[\s\S]*k=\\pm2[\s\S]*\}\{\\input\{evidence\.tex\}\}/u);
  });

  it('prints a separate answer when the final equation already gives it', () => {
    const base = fixture();
    const question = base.result?.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing signed alternatives fixture.');
    const job = JobSchema.parse({ ...base, result: { ...base.result, productionVersion: 'hand-solution-v1', questions: [{
      ...question, answer: String.raw`\(k=-2\) 또는 \(k=2\)`, steps: [{ ...step, latex: String.raw`k=\pm2` }],
    }] } });
    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toMatch(/k=\\pm2[\s\S]*\\textbf\{정답\}/u);
  });

  it('uses the finished layout when a stored job has no explicit design', () => {
    // Given: a job predating persisted PDF preferences.
    const job = JobSchema.parse({ ...fixture(), pdfDesign: undefined });
    // When: the default student layout is rendered.
    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
    // Then: the same stacked reference used by new jobs is selected.
    expect(body).toContain(String.raw`\begin{baeksinhandreference}{손풀이 참고}`);
    expect(body).not.toMatch(/\\baeksin(?:image)?recap\{/u);
  });

  it('keeps the attached sheet separate when only the first of several questions is written', () => {
    const job = JobSchema.parse({ ...fixture(), status: 'awaiting_next',
      progress: { questionNumbers: ['7', '8'], completedCount: 1 }, teacherText: 'BOTH_QUESTIONS_SENTINEL',
    });

    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
    const textOnly = renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toContain(String.raw`\baeksinsourcepage{문제·손풀이}`);
    expect(body).toContain(String.raw`\baeksinrecap{7}`);
    expect(body).not.toContain(String.raw`\baeksinstackedsource{7}`);
    expect(textOnly).not.toContain('BOTH');
  });

  it.each([[1, false], [18, false], [26, false], [1, true], [18, true]] as const)(
    'compiles %i full-size reference groups with the original and safe page continuation (v1=%s)', async (count, handSolution) => {
    // Given: an actual raster original and one or many full-size reference groups.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-stacked-reference-'));
    try {
      await mkdir(path.join(directory, 'build'));
      const python = path.resolve('python/.venv/Scripts/python.exe');
      await runPdfProcess(python, ['-c', 'from PIL import Image, ImageDraw; import sys\nim=Image.new("RGB",(800,280),"white"); d=ImageDraw.Draw(im); d.rectangle((10,10,790,270),outline="black",width=2); d.text((20,20),"SOURCE_TOP",fill="black"); d.text((20,250),"SOURCE_BOTTOM",fill="black"); im.save(sys.argv[1])', path.join(directory, 'source.png')], directory);
      const base = fixture();
      const first = base.result?.questions[0];
      const step = first?.steps[0];
      if (!first || !step) throw new Error('Missing reference fixture');
      const compactGraph = GraphSchema.parse({ title: '', xMin: 0, xMax: 2, yMin: 0, yMax: 4, xLabel: 'x', yLabel: 'y',
        points: [{ x: 1, y: 2, label: '', open: false }], verticals: [], explanation: '',
        curves: [{ expression: '(x-1)^2+2', label: 'f(x)', from: 0, to: 2, color: 'blue', dashed: false,
          samples: [{ x: 0, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 3 }] }],
      });
      const sideBooklet = StepBookletSchema.parse({ group: 'A', figure: 'side', graphLinks: [{ anchors: [{ x: 1, y: 2 }], latex: 'f(1)=2', note: '극솟값', color: 'blue' }] });
      const job = JobSchema.parse({ ...base, result: { ...base.result, ...(handSolution ? { productionVersion: 'hand-solution-v1' } : {}), questions: [{ ...first,
        firstDecision: handSolution ? '극소점의 높이를 읽는다.' : '',
        uncertainties: handSolution ? ['둘째 줄의 부호가 흐리다.'] : [],
        steps: Array.from({ length: count }, (_, index) => count === 1 ? { ...step, graph: compactGraph, booklet: sideBooklet }
          : { ...step, id: `S${index + 1}`, booklet: { group: String.fromCharCode(65 + index) } }),
      }] } });
      const graphs = new Map<string, string>();
      if (count === 1) {
        graphs.set('0-0', 'graph.tex');
        await writeFile(path.join(directory, 'graph.tex'), renderBookletGraphTex(compactGraph,
          { width: bookletNativeGraphWidth(sideBooklet, true), graphLinks: sideBooklet.graphLinks ?? [] }));
      }
      await writeFile(path.join(directory, 'main.tex'), renderPdfTex(job, [combinedImage], graphs));
      // When: XeLaTeX compiles the production breakable frame.
      const pages = await compilePdf(directory);
      // Then: short content shares the original page; long content continues without overflows or smaller text.
      if (count === 1) expect(pages).toBe(1);
      else expect(pages).toBeGreaterThan(1);
      expect((await readFile(path.join(directory, 'build/main.pdf'))).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    } finally {
      if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('solution-lab-stacked-reference-')) throw new Error('Unexpected reference fixture path');
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('places one grounded combined original before its framed reference without a duplicate problem page', () => {
    // Given: one question and the same original uploaded as problem and handwriting.
    const job = fixture();
    const original = structuredClone(job);
    // When: the finished student layout is rendered.
    const tex = renderPdfTex(job, [combinedImage], new Map());
    const body = tex.split(String.raw`\begin{document}`)[1] ?? '';
    // Then: a single original is followed directly by the full reference frame.
    expect(body.match(/source\.png/gu)).toHaveLength(1);
    expect(body.indexOf('source.png')).toBeLessThan(body.indexOf(String.raw`\begin{baeksinhandreference}`));
    expect(body).not.toMatch(/\\baeksin(?:image)?recap\{|함수의 최솟값을 구하여라/u);
    expect(body).toContain(String.raw`\begin{baeksinhandreference}{손풀이 참고}`);
    expect(job).toStrictEqual(original);
  });

  it('honors an explicit source crop before automatic single-image pairing', () => {
    // Given: the user has selected a precise original region for the question.
    const job = JobSchema.parse({ ...fixture(), files: [{ id: 'exam', name: 'original.png', mimeType: 'image/png', size: 100,
      role: 'exam', url: '/api/files/exam' }], originalProblems: [{ questionNumber: '7', fileId: 'exam', page: 1,
      trim: [24, 24, 24, 24], widthBp: 291.6 }] });
    // When: the finished reference is rendered with a combined original.
    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
    // Then: the user-selected crop is retained rather than silently replaced by the full image.
    expect(body).toContain(String.raw`trim=24bp 24bp 24bp 24bp,clip,width=291.6bp`);
  });

  it('uses a breakable frame that retains body size and native graphics rather than scaling the reference', () => {
    // Given: a finished layout with a native graph.
    const job = fixture();
    // When: the native graph is inserted in the framed reference.
    const tex = renderPdfTex(job, [combinedImage], new Map([['0-0', 'graph.tex']]));
    // Then: the frame supports page continuation and uses the full-size body.
    expect(tex).toContain(String.raw`\tcbuselibrary{breakable,skins}`);
    expect(tex).toContain('breakable');
    expect(tex).toContain(String.raw`\fontsize{11.2bp}{18.2bp}`);
    expect(tex).toContain(String.raw`\usepackage[left=17bp,right=17bp,top=30bp,bottom=30bp`);
    expect(tex).toContain(String.raw`boxsep=0bp,left=8bp,right=8bp`);
    expect(tex).toContain(String.raw`\setlength{\baeksinmarkerwidth}{12bp}`);
    expect(tex).toContain(String.raw`\setlength{\baeksinmarkergap}{4bp}`);
    expect(tex).toContain(String.raw`\input{graph.tex}`);
    expect(tex).not.toContain(String.raw`\resizebox`);
  });

  it('keeps a compact graph beside the corresponding full-size formula and reason', () => {
    // Given: a finished reference whose graph is explicitly readable as a side figure.
    const base = fixture();
    const first = base.result?.questions[0];
    const step = first?.steps[0];
    if (!first || !step) throw new Error('Missing side-figure fixture');
    const job = JobSchema.parse({ ...base, result: { ...base.result, questions: [{ ...first,
      steps: [{ ...step, booklet: { ...step.booklet, figure: 'side', graphLinks: [{ anchors: [{ x: 1, y: 2 }], latex: 'f(1)=2', note: '극솟값', color: 'blue' }] } }],
    }] } });
    // When: the compact graph and its mathematical context are laid out.
    const body = renderPdfTex(job, [combinedImage], new Map([['0-0', 'side.tex']])).split(String.raw`\begin{document}`)[1] ?? '';
    // Then: all matching content is in the same side-by-side unit without a separate wide panel.
    expect(body).toMatch(/\\begin\{baeksinside\}\{[\s\S]*f\(1\)=2[\s\S]*극값은 하나만 존재한다[\s\S]*\}\{\\input\{side\.tex\}\}/u);
    expect(body).not.toMatch(/\\begin\{center\}\\input\{side\.tex\}/u);
  });

  it('preserves an ambiguous multi-question source once instead of assigning it to every question', () => {
    // Given: two question identities but no per-question source mapping.
    const base = fixture();
    const first = base.result?.questions[0];
    if (!first) throw new Error('Missing question fixture');
    const job = JobSchema.parse({ ...base, result: { ...base.result, questions: [first, { ...first, number: '8' }] } });
    // When: the finished layout receives an ambiguous combined image.
    const body = renderPdfTex(job, [combinedImage], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
    // Then: the original is retained only once and both references remain available.
    expect(body.match(/source\.png/gu)).toHaveLength(1);
    expect(body.match(/\\begin\{baeksinhandreference\}/gu)).toHaveLength(2);
    expect(body.match(/\\baeksinrecap\{/gu)).toHaveLength(2);
  });
});
