import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { CheckMathRequestSchema } from '../shared/math.ts';
import { getCatalog, searchCatalog } from './catalog.ts';
import { designReferenceRoutes } from './design-references.ts';
import { getDefaultDesignReference } from './design-default.ts';
import { AppError } from './errors.ts';
import { configuredModel, generateSolution } from './generation.ts';
import { JobManager } from './job-manager.ts';
import type { Generator } from './job-manager.ts';
import { jobRoutes } from './job-routes.ts';
import { getKnowledgeProblem, searchKnowledge } from './knowledge.ts';
import { KnowledgeError } from './knowledge-normalize.ts';
import { checkMath } from './math-engine.ts';
import { getRules } from './reference-rules.ts';
import type { Store } from './store.ts';

type AppOptions = { readonly store: Store; readonly apiConfigured?: boolean; readonly generator?: Generator };

export function createApp(options: AppOptions) {
  const apiConfigured = options.apiConfigured ?? Boolean(process.env['OPENAI_API_KEY']);
  const app = new Hono();
  const jobs = new JobManager(options.store, options.generator ?? generateSolution, apiConfigured);
  app.use('/api/*', async (c, next) => {
    const url = new URL(c.req.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return c.json({ error: '이 PC에서만 사용할 수 있습니다.' }, 403);
    const origin = c.req.header('origin');
    if ((origin && origin !== url.origin) || c.req.header('sec-fetch-site') === 'cross-site') return c.json({ error: '현재 앱 화면에서 요청해주세요.' }, 403);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use('/api/*', bodyLimit({ maxSize: 32 * 1024 * 1024, onError: (c) => c.json({ error: '첨부파일의 합계 용량을 줄여주세요.' }, 413) }));
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ error: '입력 내용의 형식을 확인해주세요.' }, 400);
    if (error instanceof KnowledgeError) return c.json({ error: error.message }, error.code === 'missing' ? 404 : 503);
    return c.json({ error: '작업을 처리하지 못했습니다. 입력 자료와 연결 상태를 확인해주세요.' }, 500);
  });
  app.get('/api/health', (c) => c.json({ service: 'solution-lab', ok: true, apiConfigured }));
  app.get('/api/bootstrap', async (c) => {
    const [catalog, criteria] = await Promise.all([getCatalog(), getRules()]);
    return c.json({ jobs: options.store.listJobs(), catalogCount: catalog.length, cases: options.store.listCases(), apiConfigured, model: configuredModel(), criteria, defaultDesignTitle: getDefaultDesignReference(options.store)?.title ?? null });
  });
  app.get('/api/library', async (c) => c.json({ entries: await searchCatalog(c.req.query('q') ?? '', c.req.query('subject') ?? '', 500), total: (await getCatalog()).length, cases: options.store.listCases() }));
  app.get('/api/knowledge', async (c) => c.json(await searchKnowledge(c.req.query('q') ?? '')));
  app.get('/api/knowledge/:id', async (c) => c.json(await getKnowledgeProblem(c.req.param('id'))));
  app.post('/api/math/check', async (c) => c.json(await checkMath(CheckMathRequestSchema.parse(await c.req.json()))));
  app.get('/api/files/:id', async (c) => {
    const file = options.store.getFile(c.req.param('id'));
    c.header('Content-Type', file.mimeType);
    c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return c.body(await readFile(file.diskPath));
  });
  app.route('/api/jobs', jobRoutes(options.store, jobs));
  app.route('/api/design-references', designReferenceRoutes(options.store));
  app.all('/api/*', (c) => c.json({ error: '요청한 내용을 찾지 못했습니다.' }, 404));
  app.notFound((c) => c.json({ error: '요청한 내용을 찾지 못했습니다.' }, 404));
  return { app, jobs };
}
