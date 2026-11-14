import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobSchema, ResultSchema } from '../shared/contracts.ts';
import { createApp } from './app.ts';
import { readingFixture } from './generation-fixtures.ts';
import { KnowledgeLoader } from './knowledge.ts';
import { KnowledgeError } from './knowledge-normalize.ts';
import { Store } from './store.ts';

const resources: { store: Store; directory: string }[] = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.store.close();
    await rm(resource.directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'solution-lab-http-'));
  const store = new Store(directory);
  resources.push({ store, directory });
  const result = ResultSchema.parse({ summary: '계산', references: [], limitations: [],
    questions: readingFixture.questions.map(question => ({ ...question, firstDecision: '', observedOrder: [], steps: [],
      answer: '4', checks: { math: [], sequence: [], graph: [] } })),
  });
  const running = createApp({ store, apiConfigured: true, generator: async (_job, _files, _cases, options) => {
    options.question?.onReading?.(readingFixture);
    return { result, model: 'test-model' };
  } });
  return { ...running, store };
}

function examForm(): FormData {
  const body = new FormData();
  body.set('title', '검산할 문제');
  body.set('inputText', 'f(x)=x^2일 때 f(2)를 구하시오.');
  return body;
}

describe('local workbench HTTP', () => {
  it('opens the workspace when the knowledge snapshot is unavailable', async () => {
    const { app } = await fixture();
    const load = vi.spyOn(KnowledgeLoader.prototype, 'load')
      .mockRejectedValue(new KnowledgeError('integrity', 'Snapshot unavailable'));
    try {
      const response = await app.request('/api/bootstrap');
      expect(response.status).toBe(200);
    } finally {
      load.mockRestore();
    }
  });
  it('persists the original problem when a work item is submitted', async () => {
    const { app, store } = await fixture();
    const response = await app.request('/api/jobs', { method: 'POST', body: examForm() });
    const job = JobSchema.parse(await response.json());
    expect(response.status).toBe(201);
    expect(store.getJob(job.id).inputText).toBe('f(x)=x^2일 때 f(2)를 구하시오.');
    expect(job.status).toBe('draft');
  });

  it('persists a finished result after the asynchronous generator resolves', async () => {
    const { app, jobs, store } = await fixture();
    const created = JobSchema.parse(await (await app.request('/api/jobs', { method: 'POST', body: examForm() })).json());
    const response = await app.request(`/api/jobs/${created.id}/run`, { method: 'POST' });
    await jobs.idle();
    expect(response.status).toBe(202);
    expect(store.getJob(created.id).status).toBe('ready');
    expect(store.getJob(created.id).model).toBe('test-model');
  });

  it('renders a saved recipe from the requested job revision', async () => {
    const { app, store } = await fixture();
    const created = JobSchema.parse(await (await app.request('/api/jobs', { method: 'POST', body: examForm() })).json());
    const figureRecipe = await readFile(new URL('../vendor/figure-harness/3_examples/recipes/ex1_quadratic_fill.json', import.meta.url), 'utf8');
    const result = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{
      ...readingFixture.questions[0], firstDecision: '', observedOrder: [], answer: '4', checks: { math: [], sequence: [], graph: [] },
      steps: [{ id: 'S01', title: '그래프', explanation: '', latex: '', originalStep: '', evidence: '', graph: null, figureRecipe }],
    }] });
    const ready = store.saveJob({ ...created, status: 'ready', result, updatedAt: '2026-11-13T12:00:00Z' }, 'generated');
    const url = `/api/jobs/${ready.id}/figures/0/0`;
    const current = await app.request(`${url}?v=${encodeURIComponent(ready.updatedAt)}`);
    expect(current.status).toBe(200);
    expect(current.headers.get('content-type')).toBe('image/png');
    expect(current.headers.get('cache-control')).toBe('no-store');
    const currentPng = Buffer.from(await current.arrayBuffer());
    expect(currentPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    store.saveJob({ ...ready, result: null, updatedAt: '2026-11-13T12:01:00Z' }, 'edited');
    const revision = store.listRevisions(ready.id)[0]!;
    expect((await app.request(url)).status).toBe(404);
    expect((await app.request(`${url}?v=${encodeURIComponent(ready.updatedAt)}`)).status).toBe(404);
    const other = store.saveJob({ ...created, id: `${created.id}-other` }, 'created');
    expect((await app.request(`/api/jobs/${other.id}/figures/0/0?revision=${revision.id}`)).status).toBe(404);
    const historic = await app.request(`${url}?revision=${revision.id}&v=${encodeURIComponent(ready.updatedAt)}`);
    expect(historic.status).toBe(200);
    expect(Buffer.from(await historic.arrayBuffer())).toEqual(currentPng);
  }, 20_000);

  it('keeps a revision and clears approval when the reviewed content changes', async () => {
    const { app, store } = await fixture();
    const original = JobSchema.parse(await (await app.request('/api/jobs', { method: 'POST', body: examForm() })).json());
    const ready = store.saveJob({ ...original, status: 'ready', result: ResultSchema.parse({ summary: '', questions: [], references: [], limitations: [] }) }, 'generated');
    store.approve(ready);
    const response = await app.request(`/api/jobs/${original.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewNote: '조건을 먼저 확인한다.' }) });
    expect(response.status).toBe(200);
    expect(store.getJob(original.id).status).toBe('ready');
    expect(store.listCases()).toHaveLength(0);
    expect(store.listRevisions(original.id).some((revision) => revision.job.status === 'approved')).toBe(true);
  });

  it('rejects cross-origin submission before creating a work item', async () => {
    const { app, store } = await fixture();
    const response = await app.request('/api/jobs', { method: 'POST', headers: { Origin: 'https://outside.example' }, body: examForm() });
    expect(response.status).toBe(403);
    expect(store.listJobs()).toHaveLength(0);
  });

  it('does not classify reviewed AI supplementation as original handwriting', async () => {
    const { app, store } = await fixture();
    const body = examForm(); body.set('mode', 'supplement'); body.set('teacherText', 'f(2)=2^2=4');
    const original = JobSchema.parse(await (await app.request('/api/jobs', { method: 'POST', body })).json());
    const ready = store.saveJob({ ...original, status: 'ready', result: ResultSchema.parse({ summary: '', questions: [], references: [], limitations: [] }) }, 'generated');
    store.approve(ready);
    expect(store.listCases()[0]?.sourceType).toBe('approved_supplement');
  });
});
