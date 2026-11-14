import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultSchema } from '../shared/contracts.ts';
import type { Job } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { validateFigureRecipe } from './figure-recipe.ts';
import { generatedFixture, jobFixture, readingFixture } from './generation-fixtures.ts';
import { retryJobFigure } from './job-figure-retry.ts';

vi.mock('./figure-recipe.ts', () => ({ validateFigureRecipe: vi.fn() }));

const recipe = JSON.stringify({ schema_version: 'figure_recipe_v1', view: [-1, 1, -1, 1], visible_annotations: [] });
const fixes = [{ questionNumber: '1', stepId: 'S01', figureRecipe: recipe }];
const target = { questionNumber: '1', stepId: 'S01' };

function pendingJob(): Job {
  const draft = generatedFixture();
  const result = ResultSchema.parse({ ...draft, questions: draft.questions.map((question) => ({
    ...question, steps: question.steps.map(({ booklet: _booklet, ...step }) => step),
  })) });
  return {
    ...jobFixture, status: 'needs_review', result,
    reviewIssues: ['1번 S01: 화살촉이 음영 밖입니다.', '1번 S01: 정답을 확인해주세요.', '1번 S010: 그래프를 확인해주세요.'],
  };
}

function mockClient(figureRecipe = recipe) {
  const send = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const wire = await new Request(input, init).text();
    expect(wire).toContain('화살촉이 음영 밖입니다.');
    expect(wire).not.toContain('정답을 확인해주세요.');
    expect(wire).not.toContain('그래프를 확인해주세요.');
    expect(wire).not.toContain('input_image');
    expect(wire).not.toContain('input_file');
    return Response.json({
      id: 'resp_test', object: 'response', created_at: 0, status: 'completed', model: 'gpt-6.1-sol',
      error: null, incomplete_details: null,
      usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, total_tokens: 22 },
      output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({
        fixes: fixes.map((fix) => ({ ...fix, figureRecipe })),
      }), annotations: [] }] }],
    });
  });
  return { client: new OpenAI({ apiKey: 'test-only', fetch: send, maxRetries: 0 }), send };
}

describe('rerunning only the figure in a pending draft', () => {
  beforeEach(() => vi.mocked(validateFigureRecipe).mockReset());

  it('keeps the rest of the draft and reports the cost of one call', async () => {
    const job = pendingJob();
    const { client, send } = mockClient();
    const before = job.result;
    const after = await retryJobFigure(job, readingFixture, target, { client });

    expect(after.ok).toBe(true);
    if (!after.ok || !before) throw new Error('Expected a valid draft.');
    const expected = structuredClone(before);
    const step = expected.questions[0]?.steps[0];
    if (!step) throw new Error('Expected a fixture step.');
    step.figureRecipe = recipe;
    expect(after.result).toEqual(expected);
    expect(before.questions[0]?.steps[0]?.figureRecipe).toBeNull();
    expect(after.cost).toMatchObject({ requests: 1, inputTokens: 12, outputTokens: 10 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(validateFigureRecipe).toHaveBeenCalledExactlyOnceWith(recipe);
  });

  it('rejects unknown steps before making a paid request', async () => {
    const { client, send } = mockClient();
    const operation = retryJobFigure(pendingJob(), readingFixture, { ...target, stepId: 'S99' }, { client });

    await expect(operation).rejects.toMatchObject({ status: 404 });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports usage when the replacement cannot be rendered', async () => {
    const { client, send } = mockClient();
    const error = new AppError(400, '그림을 그릴 수 없습니다.');
    vi.mocked(validateFigureRecipe).mockRejectedValueOnce(error);

    const after = await retryJobFigure(pendingJob(), readingFixture, target, { client });

    expect(after).toMatchObject({ ok: false, error, cost: { requests: 1 } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects an arrow outside its own shaded region without making another call', async () => {
    const wrongArrow = JSON.stringify({
      schema_version: 'figure_recipe_v1',
      points: { label: [0, 2], tip: [1, 2] },
      curves: [{ coefficients: [0, 2, -1], fill_domain: [0, 2] }],
      paths: [{ vertices: [[0, 2], [1, 2]], arrow: 'end' }],
      visible_annotations: [{ id: 'area', target: 'label', text: '$\\int_{0}^{2}x(2-x)\\,dx$' }],
    });
    const { client, send } = mockClient(wrongArrow);

    const after = await retryJobFigure(pendingJob(), readingFixture, target, { client });

    expect(after).toMatchObject({ ok: false, error: { status: 400 }, cost: { requests: 1 } });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
