import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JobSchema, ResultSchema } from '../shared/contracts.ts';
import { DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import { createApp } from './app.ts';
import { AppError } from './errors.ts';
import { jobFixture, readingFixture } from './generation-fixtures.ts';
import * as jobFigureRetry from './job-figure-retry.ts';
import { measureApiCost } from './api-cost.ts';
import type { Generator } from './job-manager.ts';
import type { ApiCost } from '../shared/contracts.ts';
import { Store } from './store.ts';

const resources: { directory: string; store: Store }[] = [];
const numbers = ['21', '7', '18', '5', '6', '23', '9', '10', '11', '12'];
const reading = {
  ...readingFixture,
  coverage: { ...readingFixture.coverage, detectedQuestionCount: numbers.length },
  questions: numbers.flatMap(number => readingFixture.questions.map(question => ({ ...question, number }))),
};
const id = jobFixture.id;
const route = `/api/jobs/${id}`;
const post = { method: 'POST' };

afterEach(async () => {
  vi.restoreAllMocks();
  for (const resource of resources.splice(0)) {
    resource.store.close();
    if (dirname(resource.directory) !== resolve(tmpdir()) || !basename(resource.directory).startsWith('solution-lab-progress-')) {
      throw new AppError(500, '테스트 임시 폴더 경로가 올바르지 않습니다.');
    }
    await rm(resource.directory, { recursive: true, force: true });
  }
});

function createGenerator() {
  return vi.fn<Generator>(async (_job, _files, _cases, options) => {
    const scope = options?.question;
    const source = scope?.reading ?? reading;
    if (!scope?.reading) scope?.onReading?.(source);
    const question = source.questions[scope?.index ?? 0];
    if (!question) throw new AppError(503, '문항을 찾지 못했습니다.');
    const result = ResultSchema.parse({
      summary: '풀이 초안', limitations: [], references: [],
      questions: [{ ...question, firstDecision: '', observedOrder: [], steps: [], answer: '2x', checks: { math: [], sequence: [], graph: [] } }],
    });
    return { result, model: 'test-model' };
  });
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'solution-lab-progress-'));
  const store = new Store(directory);
  const resource = { directory, store };
  resources.push(resource);
  store.saveJob(jobFixture, 'created');
  const generator = createGenerator();
  return { ...createApp({ store, apiConfigured: true, generator }), store, generator, resource };
}

function next(completedCount: number): RequestInit {
  return { ...post, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completedCount }) };
}

it('saves four separate questions and waits for permission when a longer job starts', async () => {
  const { app, jobs, store, generator } = await fixture();

  expect((await app.request(`${route}/run`, post)).status).toBe(202);
  await jobs.idle();

  const saved = store.getJob(id);
  expect(saved.status).toBe('awaiting_next');
  expect(saved.progress).toEqual({ questionNumbers: numbers, completedCount: 4, authorizedCount: 4 });
  expect(saved.result?.questions.map(question => question.number)).toEqual(numbers.slice(0, 4));
  expect(generator.mock.calls.map(call => call[3].question?.index)).toEqual([0, 1, 2, 3]);
});

it('requires a fresh permission for each group of up to four, including duplicate requests', async () => {
  const { app, jobs, store, generator } = await fixture();
  await app.request(`${route}/run`, post);
  await jobs.idle();

  expect((await app.request(`${route}/run`, post)).status).toBe(409);
  expect((await app.request(`${route}/approve`, post)).status).toBe(409);
  expect((await app.request(`${route}/next`, next(5))).status).toBe(409);
  const decisions = await Promise.all([app.request(`${route}/next`, next(4)), app.request(`${route}/next`, next(4))]);
  await jobs.idle();

  expect(decisions.map(response => response.status).sort()).toEqual([202, 409]);
  expect(store.getJob(id).status).toBe('awaiting_next');
  expect(store.getJob(id).progress?.completedCount).toBe(8);
  expect(generator).toHaveBeenCalledTimes(8);
  expect((await app.request(`${route}/next`, next(4))).status).toBe(409);

  expect((await app.request(`${route}/next`, next(8))).status).toBe(202);
  await jobs.idle();
  expect(store.getJob(id).status).toBe('ready');
  expect(store.getJob(id).result?.questions.map(question => question.number)).toEqual(numbers);
  expect((await app.request(`${route}/next`, next(10))).status).toBe(409);
  expect((await app.request(`${route}/run`, post)).status).toBe(409);
  expect((await app.request(`${route}/approve`, post)).status).toBe(200);
  expect(generator).toHaveBeenCalledTimes(10);
});

it('keeps reviewed and completed work and retries only the rest of the permitted group', async () => {
  const { app, jobs, store, generator, resource } = await fixture();
  await app.request(`${route}/run`, post);
  await jobs.idle();
  const first = store.getJob(id).result;
  if (!first) throw new AppError(500, '테스트에서 작성 결과를 찾지 못했습니다.');
  const edited = { ...first, summary: '직접 고친 안내', questions: first.questions.map(question => ({ ...question, answer: '검토한 결론' })) };
  const edit = await app.request(route, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: edited, reviewNote: '첫 문항을 검토했습니다.' }),
  });
  expect(edit.status).toBe(200);
  expect(JobSchema.parse(await edit.json()).status).toBe('awaiting_next');
  const write = generator.getMockImplementation();
  if (!write) throw new AppError(500, '테스트에서 작성 도구를 찾지 못했습니다.');
  generator.mockImplementationOnce(write).mockRejectedValueOnce(new AppError(503, '잠시 후 다시 실행해주세요.'));
  await app.request(`${route}/next`, next(4));
  await jobs.idle();
  store.close();
  const reopened = new Store(resource.directory);
  resource.store = reopened;
  const restored = createApp({ store: reopened, apiConfigured: true, generator });
  expect(reopened.getJob(id)).toMatchObject({ status: 'failed', progress: { completedCount: 5, authorizedCount: 8 } });
  expect(reopened.getJob(id).result?.questions[0]?.answer).toBe('검토한 결론');

  expect((await restored.app.request(`${route}/run`, post)).status).toBe(202);
  await restored.jobs.idle();

  const retried = generator.mock.calls.slice(6).map(call => call[3].question);
  expect(retried).toEqual([5, 6, 7].map(index => ({ index, reading })));
  expect(reopened.getJob(id)).toMatchObject({
    status: 'awaiting_next', reviewNote: '첫 문항을 검토했습니다.', progress: { completedCount: 8, authorizedCount: 8 },
    result: { summary: '직접 고친 안내' },
  });
  expect(reopened.getJob(id).result?.questions.map(question => question.number)).toEqual(numbers.slice(0, 8));
  expect(reopened.getJob(id).result?.questions[0]?.answer).toBe('검토한 결론');
});

it('does not generate or lose its permission gate when reopened while waiting', async () => {
  const { app, jobs, store, generator, resource } = await fixture();
  await app.request(`${route}/run`, post);
  await jobs.idle();
  store.close();

  const reopened = new Store(resource.directory);
  resource.store = reopened;
  const restored = createApp({ store: reopened, apiConfigured: true, generator });
  const saved = JobSchema.parse(await (await restored.app.request(route)).json());

  expect(saved.status).toBe('awaiting_next');
  expect(saved.progress?.completedCount).toBe(4);
  expect(generator).toHaveBeenCalledTimes(4);
  expect((await restored.app.request(`${route}/next`, next(4))).status).toBe(202);
  await restored.jobs.idle();
  expect(generator.mock.calls[4]?.[3].question).toEqual({ index: 4, reading });
});

it('reuses the reading after the first question fails to write', async () => {
  const { app, jobs, store, generator } = await fixture();
  generator.mockImplementationOnce(async (_job, _files, _cases, options) => {
    options.question?.onReading?.(reading);
    throw new AppError(503, '잠시 후 다시 실행해주세요.');
  });
  await app.request(`${route}/run`, post);
  await jobs.idle();
  expect(store.getJob(id)).toMatchObject({ status: 'failed', result: null, progress: { completedCount: 0, authorizedCount: 4 } });

  expect((await app.request(`${route}/run`, post)).status).toBe(202);
  await jobs.idle();

  expect(generator.mock.calls[1]?.[3].question).toEqual({ index: 0, reading });
  expect(store.getJob(id).status).toBe('awaiting_next');
  expect(store.getJob(id).progress?.completedCount).toBe(4);
});

it('keeps a draft editable and pauses the already permitted group until the teacher confirms it', async () => {
  const { app, jobs, store, generator } = await fixture();
  const generate = generator.getMockImplementation();
  if (!generate) throw new AppError(500, '테스트에서 작성 도구를 찾지 못했습니다.');
  generator.mockImplementationOnce(async (...args) => ({
    ...await generate(...args), reviewIssues: ['21번 S01: 그림을 확인해주세요.'],
  }));

  await app.request(`${route}/run`, post);
  await jobs.idle();

  const draft = store.getJob(id);
  expect(draft).toMatchObject({
    status: 'needs_review', reviewIssues: ['21번 S01: 그림을 확인해주세요.'],
    progress: { completedCount: 1, authorizedCount: 4 },
  });
  expect(generator).toHaveBeenCalledTimes(1);
  expect((await app.request(`${route}/run`, post)).status).toBe(409);
  expect((await app.request(`${route}/next`, next(1))).status).toBe(409);
  expect((await app.request(`${route}/approve`, post)).status).toBe(409);
  expect((await app.request(`${route}/pdf`)).status).toBe(409);
  expect((await app.request(`${route}/pdf-preview`, {
    ...post, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfDesign: DEFAULT_PDF_DESIGN }),
  })).status).toBe(409);

  const draftResult = draft.result;
  if (!draftResult) throw new AppError(500, '테스트에서 풀이 초안을 찾지 못했습니다.');
  const result = { ...draftResult, questions: draftResult.questions.map(question => ({ ...question, answer: '수정한 결론' })) };
  const saved = JobSchema.parse(await (await app.request(route, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result }),
  })).json());
  expect(saved.status).toBe('needs_review');
  const confirm = await app.request(`${route}/complete-review`, {
    ...post, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: saved.updatedAt }),
  });
  expect(confirm.status).toBe(200);
  expect(store.getJob(id)).toMatchObject({ status: 'awaiting_next', progress: { completedCount: 1, authorizedCount: 4 } });
  expect(store.getJob(id).reviewIssues).toBeUndefined();
  expect(generator).toHaveBeenCalledTimes(1);

  expect((await app.request(`${route}/next`, next(1))).status).toBe(202);
  await jobs.idle();
  expect(store.getJob(id)).toMatchObject({ status: 'awaiting_next', progress: { completedCount: 4, authorizedCount: 4 } });
  expect(store.getJob(id).result?.questions[0]?.answer).toBe('수정한 결론');
  expect(generator.mock.calls.slice(1).map(call => call[3].question)).toEqual([1, 2, 3].map(index => ({ index, reading })));
});

const misplacedAreaArrow = JSON.stringify({
  schema_version: 'figure_recipe_v1',
  view: [-0.4, 2.4, -0.4, 3],
  axes: ['x', 'y'],
  curves: [{ id: 'p', coefficients: [0, 2, -1], plot_domain: [0, 2], fill_domain: [0, 2] }],
  points: { L: [1, 2.2], T: [1, 1.8] },
  point_markers: { L: 'none', T: 'none' },
  label_placement: 'anchored',
  strokes: [{ id: 'pointer', from: 'L', to: 'T', arrow: 'end' }],
  visible_annotations: [{ id: 'area', target: 'L', text: '$\\int_{0}^{2}x(2-x)\\,dx$', preferred_direction: 'N' }],
});

it.each([
  { figureRecipe: '{invalid recipe}', errorText: '그래프 레시피를 그리지 못했습니다.' },
  { figureRecipe: misplacedAreaArrow, errorText: '화살촉을 해당 적분 구간의 음영 내부에 놓아주세요.' },
])('blocks review completion for a final draft when the local check reports $errorText', async ({ figureRecipe, errorText }) => {
  const { app, jobs, store, generator } = await fixture();
  const generate = generator.getMockImplementation();
  if (!generate) throw new AppError(500, '테스트에서 작성 도구를 찾지 못했습니다.');
  generator.mockImplementationOnce(async (job, files, cases, options) => {
    options.question?.onReading?.(readingFixture);
    const generated = await generate(job, files, cases, { ...options, question: { index: 0, reading: readingFixture } });
    const result = ResultSchema.parse({
      ...generated.result, questions: generated.result.questions.map(question => ({
        ...question, steps: [{ id: 'S01', title: '그래프', explanation: '', latex: 'y=x', originalStep: '',
          evidence: '', graph: null, figureRecipe }],
      })),
    });
    return { ...generated, result, reviewIssues: ['1번 S01: 그래프를 그릴 수 없습니다.'] };
  });
  await app.request(`${route}/run`, post);
  await jobs.idle();
  const draft = store.getJob(id);
  expect(draft).toMatchObject({ status: 'needs_review', progress: { completedCount: 1 } });
  expect((await app.request(`${route}/approve`, post)).status).toBe(409);
  const complete = (updatedAt: string) => app.request(`${route}/complete-review`, {
    ...post, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt }),
  });
  const rejected = await complete(draft.updatedAt);
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: expect.stringContaining(errorText) });
  expect(store.getJob(id).status).toBe('needs_review');

  if (!draft.result) throw new AppError(500, '테스트에서 풀이 초안을 찾지 못했습니다.');
  const result = { ...draft.result, questions: draft.result.questions.map(question => ({
    ...question, steps: question.steps.map(step => ({ ...step, figureRecipe: null })),
  })) };
  const edited = await app.request(route, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result }),
  });
  expect(edited.status).toBe(200);
  expect((await complete(store.getJob(id).updatedAt)).status).toBe(200);
  expect(store.getJob(id).status).toBe('ready');
  expect(generator).toHaveBeenCalledTimes(1);
});

it('charges only one explicit graph retry and keeps the draft when the replacement fails', async () => {
  const { app, store } = await fixture();
  const result = ResultSchema.parse({ summary: '', limitations: [], references: [], questions: [] });
  const draft = store.saveJob({ ...jobFixture, status: 'needs_review', result }, 'generated', readingFixture);
  const cost = measureApiCost({ model: 'gpt-6.1-sol', usage: { input_tokens: 20, output_tokens: 10 } });
  const retry = vi.spyOn(jobFigureRetry, 'retryJobFigure')
    .mockResolvedValueOnce({ ok: false, error: new AppError(400, '그래프를 확인해주세요.'), cost })
    .mockResolvedValueOnce({ ok: true, result, cost });
  const retryRequest = (updatedAt: string) => app.request(`${route}/retry-figure`, {
    ...post, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt, questionNumber: '1', stepId: 'S01' }),
  });

  expect((await retryRequest('stale')).status).toBe(409);
  expect(retry).not.toHaveBeenCalled();
  expect((await retryRequest(draft.updatedAt)).status).toBe(400);
  expect(store.getJob(id)).toMatchObject({ status: 'needs_review', result, apiCost: { requests: 1 }, questionApiCosts: { '1': { requests: 1 } } });
  expect((await retryRequest(draft.updatedAt)).status).toBe(200);
  expect(store.getJob(id)).toMatchObject({ status: 'needs_review', result, apiCost: { requests: 2 }, questionApiCosts: { '1': { requests: 2 } } });
  expect(retry).toHaveBeenCalledTimes(2);
});

it('honors a single-question permission from an older interrupted job', async () => {
  const { app, jobs, store, generator } = await fixture();
  store.saveJob({ ...jobFixture, status: 'failed', progress: { questionNumbers: numbers, completedCount: 0 } }, 'interrupted', reading);

  expect((await app.request(`${route}/run`, post)).status).toBe(202);
  await jobs.idle();

  expect(store.getJob(id)).toMatchObject({ status: 'awaiting_next', progress: { completedCount: 1, authorizedCount: 1 } });
  expect(generator).toHaveBeenCalledTimes(1);
  expect((await app.request(`${route}/next`, next(1))).status).toBe(202);
  await jobs.idle();
  expect(store.getJob(id)).toMatchObject({ status: 'awaiting_next', progress: { completedCount: 5, authorizedCount: 5 } });
  expect(generator.mock.calls.map(call => call[3].question?.index)).toEqual([0, 1, 2, 3, 4]);
});

const sampleCharge: ApiCost = { requests: 1, inputTokens: 100, cachedInputTokens: 0, outputTokens: 10,
  estimatedUsd: 0.01, status: 'estimated' };

it.each([1, 10])('records the reading and writing once when a job has %i questions', async (count) => {
  const { app, jobs, store, generator } = await fixture();
  const generate = generator.getMockImplementation();
  if (!generate) throw new AppError(500, '테스트에서 작성 도구를 찾지 못했습니다.');
  generator.mockImplementation(async (job, files, cases, options) => {
    const scope = options.question;
    const source = scope?.reading ?? { ...reading, questions: reading.questions.slice(0, count) };
    if (!scope?.reading) {
      options.onApiCost?.('reading', sampleCharge);
      scope?.onReading?.(source);
    }
    options.onApiCost?.('question', sampleCharge);
    return generate(job, files, cases, { ...options, question: { index: scope?.index ?? 0, reading: source } });
  });

  await app.request(`${route}/run`, post);
  await jobs.idle();

  const saved = JobSchema.parse(await (await app.request(route)).json());
  expect(saved.apiCost?.requests).toBe(count === 1 ? 2 : 5);
  expect(saved.questionApiCosts?.['21']?.requests).toBe(count === 1 ? 2 : 1);
  expect(saved.readingApiCost?.requests).toBe(1);
  expect(store.listRevisions(id).map(revision => revision.reason)).not.toContain(null);
});

it('preserves metered calls after a failed write and adds the retry cost', async () => {
  const { app, jobs, store, generator } = await fixture();
  const generate = generator.getMockImplementation();
  if (!generate) throw new AppError(500, '테스트에서 작성 도구를 찾지 못했습니다.');
  generator.mockImplementationOnce(async (_job, _files, _cases, options) => {
    options.onApiCost?.('reading', sampleCharge);
    options.question?.onReading?.(reading);
    options.onApiCost?.('question', sampleCharge);
    throw new AppError(503, '잠시 후 다시 실행해주세요.');
  }).mockImplementation(async (job, files, cases, options) => {
    options.onApiCost?.('question', sampleCharge);
    return generate(job, files, cases, options);
  });

  await app.request(`${route}/run`, post);
  await jobs.idle();
  expect(store.getJob(id)).toMatchObject({ status: 'failed', apiCost: { requests: 2 }, questionApiCosts: { '21': { requests: 1 } } });
  await app.request(`${route}/run`, post);
  await jobs.idle();

  expect(store.getJob(id)).toMatchObject({ apiCost: { requests: 6 }, questionApiCosts: { '21': { requests: 2 } }, readingApiCost: { requests: 1 } });
});
