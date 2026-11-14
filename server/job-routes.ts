import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { hasRemainingQuestions, JobPatchSchema, ResultSchema } from '../shared/contracts.ts';
import { PdfDesignSchema } from '../shared/pdf-design.ts';
import { AppError } from './errors.ts';
import { addApiCost } from './api-cost.ts';
import { figureAreaIssues } from './figure-area-review.ts';
import { renderFigureRecipe, validateFigureRecipe } from './figure-recipe.ts';
import type { JobManager } from './job-manager.ts';
import { retryJobFigure } from './job-figure-retry.ts';
import type { Store } from './store.ts';
import { createJob } from './uploads.ts';
import { buildJobPdf, previewJobPdf } from './pdf.ts';
import { prepareEditedResult } from './result-editing.ts';
import { validateOriginalProblems } from './pdf-originals.ts';

const PdfPreviewSchema = z.object({ pdfDesign: PdfDesignSchema, result: ResultSchema.optional() });
const NextQuestionSchema = z.object({ completedCount: z.number().int().positive() });
const CompleteReviewSchema = z.object({ updatedAt: z.string().min(1) });
const RetryFigureSchema = CompleteReviewSchema.extend({ questionNumber: z.string().min(1), stepId: z.string().min(1) });
const FigureParamsSchema = z.object({
  questionIndex: z.string().regex(/^\d+$/u).pipe(z.coerce.number<string>().int().nonnegative()),
  stepIndex: z.string().regex(/^\d+$/u).pipe(z.coerce.number<string>().int().nonnegative()),
});

export function jobRoutes(store: Store, jobs: JobManager): Hono {
  const router = new Hono();
  const figureRetries = new Set<string>();
  router.post('/', async (c) => c.json(await createJob(await c.req.raw.formData(), store), 201));
  router.get('/:id', (c) => c.json(store.getJob(c.req.param('id'))));
  router.get('/:id/revisions', (c) => {
    store.getJob(c.req.param('id'));
    return c.json({ revisions: store.listRevisions(c.req.param('id')) });
  });
  router.get('/:id/figures/:questionIndex/:stepIndex', async (c) => {
    const { questionIndex, stepIndex } = FigureParamsSchema.parse(c.req.param());
    const job = store.getJob(c.req.param('id'));
    const revisionId = c.req.query('revision');
    const version = c.req.query('v');
    const saved = revisionId === undefined ? job : store.getJobRevision(job.id, revisionId);
    if (!saved || (version !== undefined && version !== saved.updatedAt)) {
      throw new AppError(404, '저장된 그래프를 찾지 못했습니다.');
    }
    const recipe = saved.result?.questions[questionIndex]?.steps[stepIndex]?.figureRecipe;
    if (!recipe) throw new AppError(404, '저장된 그래프를 찾지 못했습니다.');

    const temp = await mkdtemp(join(tmpdir(), 'solution-lab-figure-preview-'));
    const output = join(temp, 'figure.png');
    try {
      await renderFigureRecipe(recipe, output);
      return c.body(await readFile(output), 200, { 'Content-Type': 'image/png' });
    } finally {
      await rm(output, { force: true });
      await rmdir(temp);
    }
  });
  router.post('/:id/run', (c) => c.json(jobs.start(c.req.param('id')), 202));
  router.post('/:id/next', async (c) => {
    const { completedCount } = NextQuestionSchema.parse(await c.req.json());
    return c.json(jobs.next(c.req.param('id'), completedCount), 202);
  });
  router.patch('/:id', async (c) => {
    const patch = JobPatchSchema.parse(await c.req.json());
    const job = store.getJob(c.req.param('id'));
    if (figureRetries.has(job.id)) throw new AppError(409, '그래프를 다시 그린 뒤 수정해주세요.');
    if (job.status === 'running') throw new AppError(409, '풀이가 끝난 뒤 수정해주세요.');
    if (patch.result && job.progress) {
      const { completedCount, questionNumbers } = job.progress;
      if (patch.result.questions.length !== completedCount || patch.result.questions.some((question, index) => question.number !== questionNumbers[index])) {
        throw new AppError(400, '수정할 때는 작성된 문항 번호와 순서를 유지해주세요.');
      }
    }
    const originalProblems = patch.originalProblems ?? job.originalProblems;
    const result = patch.result ? await prepareEditedResult(job.result, patch.result) : job.result;
    if (figureRetries.has(job.id)) throw new AppError(409, '그래프를 다시 그린 뒤 수정해주세요.');
    validateOriginalProblems({ ...job, originalProblems, result });
    if ((patch.pdfDesign || patch.originalProblems) && patch.result === undefined && patch.title === undefined && patch.reviewNote === undefined) {
      return c.json(store.saveJob({ ...job, originalProblems, pdfDesign: patch.pdfDesign ?? job.pdfDesign, updatedAt: new Date().toISOString() }, 'edited'));
    }
    if (patch.result && JSON.stringify(store.getJob(job.id)) !== JSON.stringify(job)) {
      throw new AppError(409, '작업이 갱신되었습니다. 최신 작업을 불러온 뒤 다시 저장해주세요.');
    }
    store.removeCase(job.id);
    return c.json(store.saveJob({
      ...job, title: patch.title ?? job.title, reviewNote: patch.reviewNote ?? job.reviewNote,
      pdfDesign: patch.pdfDesign ?? job.pdfDesign, originalProblems, result,
      status: job.status === 'needs_review' || hasRemainingQuestions(job) ? job.status : result ? 'ready' : 'draft',
      updatedAt: new Date().toISOString(),
    }, 'edited'));
  });
  router.post('/:id/retry-figure', async (c) => {
    const { updatedAt, questionNumber, stepId } = RetryFigureSchema.parse(await c.req.json());
    const job = store.getJob(c.req.param('id'));
    if (figureRetries.has(job.id)) throw new AppError(409, '그래프를 다시 그리고 있습니다.');
    if (job.status !== 'needs_review' || job.updatedAt !== updatedAt) {
      throw new AppError(409, '최신 풀이 초안을 불러온 뒤 다시 그려주세요.');
    }
    figureRetries.add(job.id);
    try {
      const outcome = await retryJobFigure(job, store.getReading(job.id), { questionNumber, stepId });
      const current = store.getJob(job.id);
      const metered = outcome.cost ? {
        ...current, apiCost: addApiCost(current.apiCost, outcome.cost),
        questionApiCosts: { ...current.questionApiCosts, [questionNumber]: addApiCost(current.questionApiCosts?.[questionNumber], outcome.cost) },
      } : current;
      const stale = JSON.stringify(current) !== JSON.stringify(job);
      if (stale || !outcome.ok) {
        if (outcome.cost) store.saveJob(metered, null);
        if (stale) throw new AppError(409, '작업이 갱신되었습니다. 최신 풀이 초안을 확인해주세요.');
        if (!outcome.ok) throw outcome.error;
      }
      return c.json(store.saveJob({ ...metered, result: outcome.result, updatedAt: new Date().toISOString() }, 'figure-edited'));
    } finally {
      figureRetries.delete(job.id);
    }
  });
  router.post('/:id/complete-review', async (c) => {
    const { updatedAt } = CompleteReviewSchema.parse(await c.req.json());
    const job = store.getJob(c.req.param('id'));
    if (figureRetries.has(job.id)) throw new AppError(409, '그래프를 다시 그린 뒤 검토를 마쳐주세요.');
    if (job.status !== 'needs_review' || !job.result || job.updatedAt !== updatedAt) {
      throw new AppError(409, '최신 풀이 초안을 불러온 뒤 확인해주세요.');
    }
    const currentQuestion = job.result.questions.at(-1);
    if (!currentQuestion) throw new AppError(409, '확인할 풀이 초안이 없습니다.');
    for (const step of currentQuestion.steps) {
      if (!step.figureRecipe) continue;
      await validateFigureRecipe(step.figureRecipe);
      const issues = figureAreaIssues(step.figureRecipe, step.latex);
      if (issues.length > 0) {
        throw new AppError(400, `그래프와 넓이식의 연결을 확인해주세요. ${issues.join('\n')}`);
      }
    }
    const current = store.getJob(job.id);
    if (figureRetries.has(job.id) || JSON.stringify(current) !== JSON.stringify(job)) {
      throw new AppError(409, '작업이 갱신되었습니다. 최신 풀이 초안을 확인해주세요.');
    }
    const { reviewIssues: _reviewIssues, ...reviewed } = current;
    return c.json(store.saveJob({ ...reviewed, status: hasRemainingQuestions(current) ? 'awaiting_next' : 'ready',
      updatedAt: new Date().toISOString() }, 'reviewed'));
  });
  router.post('/:id/approve', (c) => c.json(store.approve(store.getJob(c.req.param('id')))));
  router.post('/:id/pdf-preview', async (c) => {
    const draft = PdfPreviewSchema.parse(await c.req.json());
    const job = store.getJob(c.req.param('id'));
    if (job.status === 'needs_review') throw new AppError(409, '풀이 초안을 확인한 뒤 PDF를 미리 볼 수 있습니다.');
    if (!job.result || job.status === 'running') throw new AppError(409, '미리 볼 풀이 결과가 있어야 합니다.');
    const result = draft.result ? await prepareEditedResult(job.result, draft.result) : job.result;
    const preview = { ...job, result, pdfDesign: draft.pdfDesign };
    const files = store.filesForJob(job.id);
    c.header('Vary', 'Accept');
    if (c.req.header('Accept') === 'application/json') {
      return c.json(await previewJobPdf(preview, files, 'images'));
    }
    const pdf = await previewJobPdf(preview, files);
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', 'inline');
    return c.body(pdf);
  });
  router.get('/:id/pdf', async (c) => {
    const job = store.getJob(c.req.param('id'));
    if (job.status === 'needs_review') throw new AppError(409, '풀이 초안을 확인한 뒤 PDF를 내보낼 수 있습니다.');
    const output = await buildJobPdf(job, store.filesForJob(job.id));
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(output.filename)}`);
    return c.body(await readFile(output.path));
  });
  return router;
}
