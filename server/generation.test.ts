import OpenAI from 'openai';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateSolution } from './generation.ts';
import { generatedFixture, jobFixture, libraryFixture, readingFixture } from './generation-fixtures.ts';

const RequestSchema = z.object({ model: z.string(), text: z.object({ format: z.object({ name: z.string(), type: z.literal('json_schema'), strict: z.literal(true) }) }), store: z.literal(false),
  input: z.array(z.object({ role: z.string(), content: z.unknown() })),
});

describe('OpenAI SDK wire integration', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(['text', 'figure', 'repair', 'failed-repair', 'reviewer-figure'] as const)('validates before reviewing through the real SDK (%s)', async (scenario) => {
    vi.stubEnv('OPENAI_MODEL', 'gpt-6-luna');
    vi.stubEnv('SOLUTION_LAB_CORRECTION_MODEL', 'unused-corrector');
    const stages: string[] = [];
    const models: string[] = [];
    const prompts: unknown[] = [];
    const requests: unknown[] = [];
    const figureRecipe = JSON.stringify({
      schema_version: 'figure_recipe_v1', view: [-0.5, 2, -0.5, 4], axes: ['x', 'y'],
      label_placement: 'anchored', points: { P: [1, 1] }, point_markers: { P: 'filled' },
      curves: [{ id: 'curve_1', coefficients: [0, 0, 1], plot_domain: [0, 2] }],
      visible_annotations: [{ id: 'label_P', text: '$P$', target: 'P', preferred_direction: 'NW' }],
    });
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Missing SDK JSON request.');
      const request: unknown = JSON.parse(init.body);
      requests.push(request);
      const parsed = RequestSchema.parse(request);
      stages.push(parsed.text.format.name);
      models.push(parsed.model);
      prompts.push(parsed.input.find((message) => message.role === 'system')?.content);
      const draft = generatedFixture();
      const step = draft.questions[0]?.steps[0];
      if (!step) throw new Error('Missing fixture step.');
      if (scenario !== 'text') {
        step.booklet = {
          group: null, equationRole: 'key', keyPhrases: ['차분을 전개한다.'], equationNote: null, takeaway: null,
          referenceTip: null, termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null,
        };
        step.figureRecipe = scenario === 'repair' || scenario === 'failed-repair' ? '{"schema_version":"figure_recipe_v1","unknown":1}' : figureRecipe;
      }
      const output = parsed.text.format.name === 'exam_reading' ? readingFixture
        : parsed.text.format.name === 'student_math_review' ? {
          issues: scenario === 'reviewer-figure' && !stages.includes('figure_recipe_correction') ? ['[그림만] 1번 S01: 점 라벨 확인'] : [],
        }
          : parsed.text.format.name === 'figure_recipe_correction' ? { fixes: [{ questionNumber: '1', stepId: 'S01',
            figureRecipe: scenario === 'failed-repair' ? '{"schema_version":"figure_recipe_v1","unknown":1}' : figureRecipe }] } : draft;
      return Response.json({
        id: `resp_${stages.length}`, object: 'response', created_at: 0, status: 'completed', model: 'local-sdk-test',
        error: null, incomplete_details: null,
        output: [{ id: `msg_${stages.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      });
    };
    const client = new OpenAI({ apiKey: 'test-only', fetch, maxRetries: 0 });
    const job = scenario === 'text' ? jobFixture : { ...jobFixture, mode: 'supplement' as const };
    const temp = await mkdtemp(join(tmpdir(), 'solution-lab-sdk-test-'));
    const diskPath = join(temp, 'exam.png');
    await writeFile(diskPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=', 'base64'));
    const file = { id: 'exam-file', name: 'exam.png', role: 'exam' as const, jobId: job.id, diskPath, mimeType: 'image/png', size: 68, url: '' };
    const generated = await generateSolution(job, [file], [], { client, knowledgeLoader: async () => libraryFixture }).finally(async () => {
      await unlink(diskPath);
      await rmdir(temp);
    });
    const expectedStages = ['exam_reading', 'solution_draft'];
    if (scenario === 'repair' || scenario === 'failed-repair') expectedStages.push('figure_recipe_correction');
    if (scenario === 'reviewer-figure') expectedStages.push('student_math_review', 'figure_recipe_correction');
    if (scenario !== 'failed-repair') expectedStages.push('student_math_review');
    expect(stages).toEqual(expectedStages);
    expect(JSON.stringify(requests[0])).toContain('input_image');
    expect(JSON.stringify(requests.slice(1))).not.toContain('input_image');
    expect(models).toEqual(expectedStages.map(() => 'gpt-6-luna'));
    for (const prompt of prompts.filter((_, index) => stages[index] !== 'figure_recipe_correction')) {
      expect(prompt).toContain('# 손해설 제작 프로젝트 v1');
      expect(prompt).toContain('# 해설 생성 금지 항목');
      expect(prompt).toContain('선택한 과목은 미적분Ⅰ');
    }
    expect(prompts[1]).toContain('그림은 코드 실행 없이 figure_recipe_v1 데이터로만 작성한다.');
    const request = z.object({ text: z.object({ format: z.object({ schema: z.unknown() }) }) }).parse(requests[1]);
    expect(request.text.format.schema).toMatchObject({
      properties: { questions: { items: { properties: { steps: { items: { required: expect.arrayContaining(['figureRecipe']) } } } } } },
    });
    expect(generated.result.productionVersion).toBe('hand-solution-v1');
    expect(generated.result.questions[0]?.answer).toBe('2x');
    expect(generated.result.provenance?.sampleIds).toEqual(['P01']);
    expect(generated.model).toBe('local-sdk-test');
    if (scenario === 'figure' || scenario === 'repair') {
      expect(generated.result.questions[0]?.steps[0]).toMatchObject({
        figureRecipe, graph: null, booklet: { equationRole: 'key', keyPhrases: ['차분을 전개한다.'], figure: 'wide' },
      });
      expect(JSON.stringify(requests.at(-1))).toContain('figure_recipe_v1');
    }
    if (scenario === 'repair' || scenario === 'failed-repair') {
      expect(JSON.stringify(requests[2])).toContain('그림을 그릴 수 없습니다');
      expect(JSON.stringify(requests[2])).not.toContain('input_image');
    }
    if (scenario === 'failed-repair') {
      expect(generated).toMatchObject({ reviewIssues: [expect.stringContaining('그림을 그릴 수 없습니다')] });
    }
  }, 45_000);
});
