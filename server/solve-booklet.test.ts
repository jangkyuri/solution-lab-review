import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { buildReadingInput } from './generation-input.ts';
import { finalizeGeneration } from './generation-finalize.ts';
import { generationQualityIssues } from './generation-quality.ts';
import { generatedFixture, jobFixture, libraryFixture, readingFixture, exampleFixture } from './generation-fixtures.ts';
import { GeneratedResultSchema } from './generation-schemas.ts';
import type { GeneratedResult } from './generation-schemas.ts';
import { buildJobPdf } from './pdf.ts';
import { prepareGraphs } from './graphs.ts';
import { renderPdfTex } from './pdf-template.ts';

type Booklet = NonNullable<GeneratedResult['questions'][number]['steps'][number]['booklet']>;
const booklet = (): Booklet => ({ group: null, equationRole: 'key', keyPhrases: ['차분을 전개한다.'], equationNote: null,
  takeaway: null, referenceTip: null, termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null });
async function removeStage(directory: string, prefix: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error('Refusing to remove a stage outside the intended temp folder');
  }
  await rm(resolved, { recursive: true, force: true });
}
const solveJob = { ...jobFixture, mode: 'solve' as const, pdfDesign: BAEKSIN_V16_PDF_DESIGN };

function resultWithBooklet(): GeneratedResult {
  const draft = generatedFixture();
  const step = draft.questions[0]?.steps[0];
  if (!step) throw new Error('Missing step fixture');
  step.booklet = booklet();
  return draft;
}

describe('Baeksin design in new solutions', () => {
  it('preserves layout annotations while clearing teacher provenance in solve results', () => {
    // Given: a new solution has layout annotations and untrusted original fields.
    const draft = resultWithBooklet();
    // When: the normal finalization stores the new solution.
    const result = finalizeGeneration(draft, readingFixture, 'solve', libraryFixture, [exampleFixture]);
    // Then: layout survives, but no generated step is represented as teacher handwriting.
    expect(result.questions[0]?.steps[0]?.booklet?.equationRole).toBe('key');
    expect(result.questions[0]?.steps[0]?.originalStep).toBe('');
    expect(result.questions[0]?.steps[0]?.sourceConflict).toBeNull();
    expect(result.questions[0]?.observedOrder).toEqual([]);
  });

  it('applies math safety checks without forbidding a newly defined helper in solve mode', () => {
    // Given: the new solution can introduce a helper, but cannot contain unsafe math.
    const draft = resultWithBooklet();
    const step = draft.questions[0]?.steps[0];
    if (!step) throw new Error('Missing step fixture');
    step.explanation = String.raw`\(g(x)=f(x)\)로 두고 차분을 전개한다.`;
    expect(generationQualityIssues(solveJob, readingFixture, draft)).toEqual([]);
    step.latex = String.raw`\input{external}`;
    // When: shared quality checks inspect the student output.
    const issues = generationQualityIssues(solveJob, readingFixture, draft);
    // Then: unsafe math is caught independently of the solve-only helper.
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(issue => issue.includes('새로 정의'))).toBe(false);
  });

  it('requires selected emphasis for a multi-step new solution', () => {
    // Given: a two-step new solution has no selected visual emphasis.
    const draft = generatedFixture();
    const question = draft.questions[0];
    const first = question?.steps[0];
    if (!question || !first) throw new Error('Missing step fixture');
    question.steps.push({ ...first, id: 'S02', after: ['S01'] });
    // When: the Baeksin quality boundary inspects the result.
    const issues = generationQualityIssues(solveJob, readingFixture, draft);
    // Then: it reports missing emphasis just as for a handwriting supplement.
    expect(issues.length).toBeGreaterThan(0);
  });

  it('passes source matching instructions as trusted task metadata and references as references', async () => {
    // Given: a source map and a printed reference attached to a solve job.
    const directory = await mkdtemp(path.join(tmpdir(), 'solve-source-role-'));
    try {
      const file = path.join(directory, 'reference.pdf');
      await writeFile(file, '%PDF-test-reference');
      const job = { ...solveJob, instruction: '5->1;6->2' };
      // When: the app packages its normal reading request.
      const input = await buildReadingInput(job, [{ id: 'reference', jobId: job.id, name: 'reference.pdf',
        mimeType: 'application/pdf', size: 19, role: 'handwriting', url: '/reference', diskPath: file }]);
      const header = input[0];
      const attachment = input[1];
      if (header?.type !== 'input_text' || attachment?.type !== 'input_text') throw new Error('Missing metadata');
      // Then: machine-consumed metadata distinguishes the task instruction and reference role.
      expect(JSON.parse(header.text)).toMatchObject({ task: { mode: 'solve', userInstruction: job.instruction },
        suppliedHandwritingText: '', attachments: [{ name: 'reference.pdf', role: 'reference' }] });
      expect(JSON.parse(attachment.text)).toMatchObject({ attachmentRole: 'reference' });
    } finally { await removeStage(directory, 'solve-'); }
  });

  it('routes new solutions through the booklet and omits printed reference pages from student output', () => {
    // Given: a new solution has the chosen design, input exam and printed reference.
    const result = finalizeGeneration(resultWithBooklet(), readingFixture, 'solve', libraryFixture, [exampleFixture]);
    const job = JobSchema.parse({ ...solveJob, status: 'ready', result });
    // When: the same renderer formats it for a student.
    const tex = renderPdfTex(job, [
      { localName: 'exam.pdf', name: 'exam.pdf', mimeType: 'application/pdf', role: 'exam', sourceFileIds: ['exam'] },
      { localName: 'reference.pdf', name: 'reference.pdf', mimeType: 'application/pdf', role: 'handwriting', sourceFileIds: ['reference'] },
    ], new Map());
    // Then: exam pages and student booklet remain; reference pages and review metadata do not.
    expect(tex).toContain(String.raw`\baeksinrecap{1}`);
    expect(tex).toContain('{exam.pdf}');
    expect(tex).not.toContain('{reference.pdf}');
    expect(tex).not.toContain('snapshot-1');
    expect(tex).not.toContain('손풀이');
  });

  it('compiles a new solution with native graph anchors and student-only pages', async () => {
    // Given: a new solution graph has a point-to-equation link in the selected design.
    const directory = await mkdtemp(path.join(tmpdir(), 'solve-booklet-native-'));
    try {
      const draft = resultWithBooklet();
      const step = draft.questions[0]?.steps[0];
      if (!step || !step.booklet) throw new Error('Missing layout fixture');
      step.graph = { title: '함숫값', variable: 'x', qualitative: false, xMin: 0, xMax: 3, yMin: 0, yMax: 9,
        xLabel: 'x', yLabel: 'y', explanation: '', curves: [{ label: String.raw`\(f(x)=x^2\)`, expression: 'x^2', color: 'blue', from: 0, to: 3, dashed: false }],
        points: [{ x: 2, y: 4, label: '', open: false }], verticals: [], horizontals: [], arrows: [], shades: [] };
      step.booklet.figure = 'wide';
      step.booklet.graphLinks = [{ anchors: [{ x: 2, y: 4 }], anchorLabels: ['함숫값'], latex: 'f(2)=4', note: '', color: 'blue' }];
      const checked = GeneratedResultSchema.parse(draft);
      const result = await prepareGraphs(finalizeGeneration(checked, readingFixture, 'solve', libraryFixture, [exampleFixture]));
      expect(result.questions[0]?.steps[0]?.graph?.curves[0]?.samples.length).toBeGreaterThan(100);
      const job = JobSchema.parse({ ...solveJob, status: 'ready', result });
      // When: the ordinary export pipeline renders and compiles the native graph.
      const output = await buildJobPdf(job, [], directory);
      // Then: a sampled curve and its equation link compile into two student pages.
      expect((await readFile(output.path)).subarray(0, 5).toString()).toBe('%PDF-');
      expect(output.pageCount).toBe(2);
    } finally { await removeStage(directory, 'solve-'); }
  }, 120_000);
});
