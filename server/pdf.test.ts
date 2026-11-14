import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JobSchema, ResultSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN, DEFAULT_PDF_DESIGN, LEGACY_PDF_DESIGN } from '../shared/pdf-design.ts';
import { createApp } from './app.ts';
import { buildJobPdf, previewJobPdf } from './pdf.ts';
import { convertWebp, runPdfProcess } from './pdf-runtime.ts';
import { renderPdfTex } from './pdf-template.ts';
import { Store } from './store.ts';

const job = JobSchema.parse({
  id: 'pdf-test-job', title: '극한과 미분', subject: '미적1', mode: 'supplement', status: 'ready',
  inputText: '함수 f(x)=x^2에서 x=2일 때 미분계수를 구하여라.', teacherText: '미분계수 정의를 먼저 쓴다.',
  instruction: '', reviewNote: '', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z',
  files: [], error: null, model: null, pdfDesign: LEGACY_PDF_DESIGN,
  result: {
    summary: '미분계수 정의와 그래프의 기울기를 연결한다.', references: [], limitations: [],
    questions: [{
      number: '1', problemText: String.raw`함수 \(f(x)=x^2\)에서 \(x=2\)일 때 미분계수를 구하여라.`,
      firstDecision: '원래 풀이처럼 미분계수의 정의를 먼저 쓴다.', variables: ['x', 'h'], observedOrder: ['정의', '정리', '극한'],
      steps: [{
        id: 'S01', after: [], branch: 'main', title: '차이를 h로 나눈다', originalStep: String.raw`\(\frac{(2+h)^2-4}{h}\)`,
        explanation: '두 점을 잇는 직선의 기울기를 식으로 옮긴다. h가 0이 아니므로 약분할 수 있다. '.repeat(28),
        latex: String.raw`\lim_{h\to 0}\frac{(2+h)^2-4}{h}=\lim_{h\to 0}(4+h)=4`,
        evidence: '원본의 미분계수 정의와 약분 순서를 유지했다.', graph: {
          title: '곡선의 점과 접선의 기울기', xMin: -0.5, xMax: 3.5, yMin: -1, yMax: 10,
          xLabel: 'x', yLabel: 'y', explanation: '점 (2, 4)에서 접선의 기울기는 미분계수 4와 같다.',
          curves: [{ label: 'f(x)=x²', expression: 'x^2', color: 'blue', from: -0.5, to: 3.5, dashed: false,
            samples: Array.from({ length: 201 }, (_, index) => { const x = -0.5 + index / 50; return { x, y: x * x }; }) }],
          points: [{ x: 2, y: 4, label: '(2, 4)', open: false }], verticals: [{ x: 2, label: '같은 가로좌표' }],
        },
      }],
      answer: '미분계수는 4이다.', uncertainties: [], checks: { math: ['미분계수 4 확인', '음수 부호 −의 표기를 확인했습니다.'], sequence: ['원래 h 유지'], graph: [] },
    }],
  },
});

describe('XeLaTeX PDF export', () => {
  it('embeds a recipe-only graph in the preview and export and reports invalid recipes', async () => {
    const figureRecipe = await readFile(new URL('../vendor/figure-harness/3_examples/recipes/ex1_quadratic_fill.json', import.meta.url), 'utf8');
    const result = job.result;
    const question = result?.questions[0];
    const step = question?.steps[0];
    if (!result || !question || !step) throw new Error('PDF fixture is missing its first step');
    const withFigure = (recipe: string) => JobSchema.parse({
      ...job, mode: 'solve', teacherText: '', pdfDesign: DEFAULT_PDF_DESIGN,
      result: { ...result, productionVersion: 'hand-solution-v1', questions: [{
        ...question, steps: [{ ...step, explanation: '', latex: '', originalStep: '', graph: null, figureRecipe: recipe }],
      }] },
    });
    const graphJob = withFigure(figureRecipe);
    const preview = await previewJobPdf(graphJob, []);
    expect(preview.toString('latin1')).toMatch(/\/Subtype\s*\/Image/u);

    const prefix = 'solution-lab-pdf-recipe-test-';
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    try {
      const output = await buildJobPdf(graphJob, [], directory);
      const exported = await readFile(output.path);
      expect(exported.toString('latin1')).toMatch(/\/Subtype\s*\/Image/u);
      expect(output.pageCount).toBe(1);
      const receipt = await readFile(output.path.replace(/\.pdf$/u, '.figure-recipes.json'), 'utf8');
      expect(JSON.parse(receipt)).toEqual({ figures: [{
        questionNumber: '1', stepId: 'S01', stepNumber: 1, bytes: expect.any(Number),
        labels: expect.arrayContaining(['$y=x(4-x)$']),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        recipe_sha256: createHash('sha256').update(figureRecipe).digest('hex'),
      }] });
      await expect(previewJobPdf(withFigure('{}'), [])).rejects.toThrow('그래프 레시피를 그리지 못했습니다.');
    } finally {
      if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith(prefix)) {
        throw new Error('Unexpected PDF export test directory');
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 150_000);

  it('renders an unsaved PDF design without altering the job, revisions or export history', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-pdf-preview-test-'));
    const store = new Store(directory);
    const id = randomUUID();
    const published = path.resolve('data', 'exports', createHash('sha256').update(id).digest('hex').slice(0, 20));
    try {
      const firstQuestion = job.result?.questions[0];
      const firstStep = firstQuestion?.steps[0];
      if (!firstQuestion || !firstStep) throw new Error('PDF fixture is missing its first step');
      const stepCount = 9;
      const result = ResultSchema.parse({
        ...job.result,
        questions: [{
          ...firstQuestion,
          steps: Array.from({ length: stepCount }, (_, index) => ({
            ...firstStep, id: `S0${index + 1}`, after: index === 0 ? [] : [`S0${index}`],
            explanation: '미분계수의 정의에 대입합니다.', graph: null,
          })),
        }],
      });
      const original = store.approve(store.saveJob(JobSchema.parse({ ...job, id, result }), 'generated'));
      const revisions = store.listRevisions(id);
      const cases = store.listCases();
      const { app } = createApp({ store, apiConfigured: false });
      const pdfDesign = { fontSize: 12, margins: 'wide', stepLayout: 'separate' } as const;
      const draft = { ...result, summary: '미리보기에서만 사용하는 요약' };

      const preview = await app.request(`/api/jobs/${id}/pdf-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfDesign, result: draft }),
      });
      expect(preview.status).toBe(200);
      expect(preview.headers.get('Content-Type')).toBe('application/pdf');
      expect(preview.headers.get('Content-Disposition')).toBe('inline');
      expect(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString('ascii')).toBe('%PDF-');

      const visualPreview = await app.request(`/api/jobs/${id}/pdf-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ pdfDesign, result: draft }),
      });
      expect(visualPreview.status).toBe(200);
      expect(visualPreview.headers.get('Content-Type')).toContain('application/json');
      const rendered = z.object({
        pdfBase64: z.string(), pageCount: z.number(), pages: z.array(z.object({ number: z.number(), jpegBase64: z.string() })),
      }).parse(await visualPreview.json());
      expect(rendered.pageCount).toBeGreaterThanOrEqual(1 + stepCount);
      expect(rendered.pages.map((page) => page.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(Buffer.from(rendered.pdfBase64, 'base64').subarray(0, 5).toString('ascii')).toBe('%PDF-');
      for (const page of rendered.pages) {
        expect(Buffer.from(page.jpegBase64, 'base64').subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      }
      expect(store.getJob(id)).toEqual(original);
      expect(store.listRevisions(id)).toEqual(revisions);
      await expect(access(published)).rejects.toMatchObject({ code: 'ENOENT' });

      const saved = await app.request(`/api/jobs/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfDesign }),
      });
      expect(saved.status).toBe(200);
      const updated = JobSchema.parse(await saved.json());
      expect(updated.pdfDesign).toEqual(pdfDesign);
      expect(updated.status).toBe('approved');
      expect(updated.result).toEqual(original.result);
      expect(store.listCases()).toEqual(cases);
      const tex = renderPdfTex(updated, [], new Map());
      expect(tex).toContain(String.raw`\documentclass[12pt,a4paper]{article}`);
      expect(tex).toContain(String.raw`\usepackage[left=25mm,right=25mm,top=25mm,bottom=25mm]{geometry}`);
      expect(tex).toMatch(/\\clearpage\s+\\sectionlabel\{S02/u);
    } finally {
      store.close();
      if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('solution-lab-pdf-preview-test-')) {
        throw new Error('Unexpected PDF preview test directory');
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 150_000);

  it('identifies a solve-only result and accurately labels a lookup with no applied examples', () => {
    const solveOnly = JobSchema.parse({
      ...job, mode: 'solve', teacherText: '',
      result: {
        ...job.result,
        questions: job.result?.questions.map((question) => ({
          ...question,
          steps: question.steps.map((step) => ({ ...step, originalStep: '' })),
          checks: { ...question.checks, sequence: ['observedOrder는 비웠습니다.'] },
        })),
        limitations: [
          '제공된 methodExamples에는 이 문제에 적용할 풀이가 없습니다.',
          '기준 표본의 관찰 기록을 참고한 검토 전 초안입니다. 교사 승인과 수학적 검산은 별도로 확인해주세요.',
        ],
        provenance: {
          snapshotId: 'qa-snapshot', capturedAt: job.createdAt, sampleIds: [], exampleJobIds: [],
          mode: 'solve', evidenceStatus: 'observed_not_teacher_approved',
        },
      },
    });

    const tex = renderPdfTex(solveOnly, [], new Map());

    expect(tex).toContain(String.raw`\sectionlabel{문항 1 · 문제}`);
    expect(tex).toMatch(/\\setsupplement\{1\}\{.*\}\{풀이\}/u);
    expect(tex).toContain('풀이 기록 조회 결과');
    expect(tex).toContain('qa-snapshot');
    expect(tex).not.toMatch(/근거 문항|참고한 풀이 기록|관찰 기록을 참고|observedOrder|methodExamples/u);
  });

  const combinedAsset = [{
    localName: 'source-1.png', name: '문제와 손풀이.png', mimeType: 'image/png', role: 'exam_and_handwriting', sourceFileIds: ['exam'],
  }] as const;

  it('renders the Baeksin visual profiles and preserves the matched original separately', () => {
    // Given: a combined source and several student visuals across the original steps.
    const question = job.result?.questions[0];
    const firstStep = question?.steps[0];
    if (!question || !firstStep) throw new Error('PDF fixture is missing its first step');
    const booklet = [
      { group: 'A', referenceTip: '미분계수는 접선의 기울기와 같다.' },
      { group: 'B', figure: 'wide', termNotes: [{ term: '4h', note: 'h에 비례하는 항', color: 'brown' }],
        table: [['대상', '기울기'], ['접선', '미분계수']] },
      { group: 'B', figure: 'small' },
      { group: 'B', zoom: { xMin: 1.5, xMax: 2.5, yMin: 2, yMax: 7 }, zoomNote: '접점 근처를 확대한다.' },
    ] as const;
    const steps = booklet.map((layout, index) => ({
      ...firstStep, id: `S0${index + 1}`, after: index === 0 ? [] : [`S0${index}`], booklet: layout,
      explanation: '곡선 위 두 점의 기울기를 비교한다.', latex: '(2+h)^2-4=4h+h^2',
      originalStep: '원본 단계 전사', evidence: '내부 검토 근거',
    }));
    const baeksin = JobSchema.parse({
      ...job, pdfDesign: BAEKSIN_V16_PDF_DESIGN, reviewNote: '내부 검토 메모',
      result: { ...job.result, questions: [{ ...question, steps }], limitations: ['내부 검토 제한'],
        references: [{ id: 'P01', title: '검토용 참조', reason: '기울기 연결' }] },
    });

    // When: the booklet is rendered with the verified main and zoom assets.
    const graphs = new Map([
      ['0-0', 'graph-side.pdf'], ['0-1', 'graph-wide.pdf'], ['0-2', 'graph-small.pdf'],
      ['0-3', 'graph-main.pdf'], ['0-3:zoom', 'graph-detail.pdf'],
    ]);
    const documentBody = renderPdfTex(baeksin, combinedAsset, graphs).split(String.raw`\begin{document}`)[1] ?? '';

    // Then: the original appears once and only student-facing content follows.
    expect(documentBody).toMatch(/\\baeksinsourcepage\b[\s\S]*?source-1\.png[\s\S]*?\\baeksinrecap\b/u);
    expect(documentBody.match(/source-1\.png/gu) ?? []).toHaveLength(1);
    expect(Array.from(documentBody.matchAll(/\\begin\{baeksingroup\}\{([A-Z])\}/gu), (match) => match[1])).toEqual(['A', 'B']);
    expect(documentBody).toMatch(/\\begin\{baeksinside\}[\s\S]*?graph-side\.pdf[\s\S]*?\\end\{baeksinside\}/u);
    expect(documentBody).toContain(String.raw`\baeksinreference{미분계수는 접선의 기울기와 같다.}`);
    expect(documentBody).toContain(String.raw`\baeksinterm{warm}{4h}{h에 비례하는 항}`);
    expect(documentBody).toMatch(/\\includegraphics\[width=\.96\\linewidth,[^\]]+\]\{graph-wide\.pdf\}/u);
    expect(documentBody).toMatch(/\\includegraphics\[width=150bp,[^\]]+\]\{graph-small\.pdf\}/u);
    expect(documentBody).toMatch(/\\baeksinzoom\{[^{}]+\{graph-main\.pdf\}\}\{[^{}]+\{graph-detail\.pdf\}\}\{접점 근처를 확대한다\.\}/u);
    expect(documentBody).toMatch(/\\begin\{tabular\}\{[^|\n]+\}\n대상 & 기울기 \\\\\n접선 & 미분계수\n\\end\{tabular\}/u);
    expect(documentBody).toContain('미분계수를 구하여라.');
    expect(documentBody).toContain('곡선 위 두 점의 기울기를 비교한다.');
    expect(documentBody).not.toMatch(/첨부 원본 묶음|판독한 원문|원본 단계 전사|앞선 연결|내부 검토|검토용 참조/u);
  });

  it.each([
    { scenario: 'several questions make the match ambiguous', design: BAEKSIN_V16_PDF_DESIGN, legacy: false },
    { scenario: 'the plain template is selected', design: LEGACY_PDF_DESIGN, legacy: true },
  ])('preserves the source material when $scenario', ({ design, legacy }) => {
    // Given: a combined image without a usable Baeksin pairing.
    const question = job.result?.questions[0];
    if (!question) throw new Error('PDF fixture is missing its first question');
    const questions = legacy ? [question] : [question, { ...question, number: '2' }];
    const candidate = JobSchema.parse({ ...job, pdfDesign: design, result: { ...job.result, questions } });

    // When: the result is rendered.
    const tex = renderPdfTex(candidate, combinedAsset, new Map());
    const documentBody = tex.split(String.raw`\begin{document}`)[1] ?? '';

    // Then: both layouts keep the source before the student material, and only plain adds review narration.
    expect(documentBody.match(/source-1\.png/gu) ?? []).toHaveLength(1);
    expect(documentBody).toContain('미분계수를 구하여라.');
    expect(documentBody.indexOf('source-1.png')).toBeLessThan(documentBody.indexOf('미분계수를 구하여라.'));
    expect(documentBody.includes('판독한 원문')).toBe(legacy);
    expect(documentBody.includes('검토 기록')).toBe(legacy);
    if (legacy) {
      expect(documentBody).toContain('첨부 원본 묶음');
      expect(documentBody).not.toMatch(/\\baeksinsourcepage\b/u);
    }
  });

  it('converts an uploaded WebP copy to a readable PNG without changing its source', async () => {
    // Given: graphicx cannot directly include a WebP source.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-pdf-test-'));
    const source = path.join(directory, 'source.webp');
    const target = path.join(directory, 'source.png');
    try {
      const python = path.resolve('python', '.venv', 'Scripts', 'python.exe');
      const script = 'from PIL import Image; import sys\nwith Image.new("RGBA", (4, 4), (60, 93, 114, 255)) as image:\n image.save(sys.argv[1], "WEBP", lossless=True)';
      await runPdfProcess(python, ['-c', script, source], directory, 30_000);
      const original = await readFile(source);
      // When: PDF preparation converts only its staging copy.
      await convertWebp(source, target, directory);
      const converted = await readFile(target);
      // Then: XeLaTeX receives PNG and original bytes stay identical.
      expect(converted.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(await readFile(source)).toEqual(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('builds a real PDF with separate original and supplement pages', async () => {
    // Given: a Korean question and its preserved handwritten reasoning.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-pdf-test-'));
    try {
      // When: the completed job is exported through the actual XeLaTeX pipeline.
      const output = await buildJobPdf(job, [], directory);
      const bytes = await readFile(output.path);
      // Then: a multi-page PDF is produced with a versioned basename.
      expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(output.pageCount).toBeGreaterThanOrEqual(3);
      expect(output.filename).toMatch(/_v01_02정답해설\.pdf$/u);
      if (process.env['SOLUTION_LAB_PDF_QA'] === '1') {
        const evidence = path.resolve('latex', 'qa');
        await mkdir(evidence, { recursive: true });
        await copyFile(output.path, path.join(evidence, '미적1_PDF출력검증_v01_02정답해설.pdf'));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 150_000);
});
