import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { repairGeneratedFigures } from './generation-figure-repair.ts';
import { generatedFixture, readingFixture } from './generation-fixtures.ts';

const recipe = JSON.stringify({ schema_version: 'figure_recipe_v1', view: [-1, 1, -1, 1], visible_annotations: [] });
const fixes = [{ questionNumber: '1', stepId: 'S01', figureRecipe: recipe }];
const wireSchema = z.object({ input: z.array(z.object({ role: z.string(), content: z.string() })) });
const request = {
  model: 'gpt-6.1-sol', reading: readingFixture, instructions: '그림은 figure_recipe_v1으로 쓴다.',
  targets: [{ questionNumber: '1', stepId: 'S01', issues: ['화살촉이 음영 밖에 있습니다.'] }],
};

function mockClient(output: unknown) {
  const send = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const wire: unknown = await new Request(input, init).json();
    const messages = wireSchema.parse(wire).input;
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain(readingFixture.questions[0]?.problemText);
    expect(messages[1]?.content).toContain('화살촉이 음영 밖에 있습니다.');
    expect(messages[1]?.content).not.toContain('out-of-scope-solution');
    return Response.json({
      id: 'resp_test', object: 'response', created_at: 0, status: 'completed', model: 'gpt-6.1-sol',
      error: null, incomplete_details: null,
      usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, total_tokens: 22 },
      output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: typeof output === 'string' ? output : JSON.stringify(output), annotations: [] }] }],
    });
  });
  return { client: new OpenAI({ apiKey: 'test-only', fetch: send, maxRetries: 0 }), send };
}

describe('graph-only correction', () => {
  it('charges one text-only call and changes only the named recipe', async () => {
    const { client, send } = mockClient({ fixes });
    const generated = generatedFixture();
    const question = generated.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing fixture step.');
    question.steps.push({ ...step, id: 'S02', explanation: 'out-of-scope-solution' });
    const onApiCost = vi.fn();

    const corrected = await repairGeneratedFigures(client, { ...request, generated, onApiCost });

    expect(corrected).toEqual({
      ...generated, questions: [{ ...question, steps: [{ ...step, figureRecipe: recipe }, question.steps[1]] }],
    });
    expect(generated.questions[0]?.steps[0]?.figureRecipe).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onApiCost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requests: 1, inputTokens: 12, outputTokens: 10 }));
  });

  it.each([
    'malformed outer JSON',
    { fixes: [] },
    { fixes: [...fixes, ...fixes] },
    { fixes: [{ ...fixes[0], questionNumber: '2', stepId: 'S01' }] },
    { fixes: [{ ...fixes[0], stepId: 'S02' }] },
    { fixes: [{ ...fixes[0], figureRecipe: 'broken JSON' }] },
    { fixes: [{ ...fixes[0], answer: 'outside permitted fields' }] },
  ])('discards an unusable patch as a whole', async (output) => {
    const { client, send } = mockClient(output);

    const corrected = await repairGeneratedFigures(client, { ...request, generated: generatedFixture() });

    expect(corrected).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips the paid request when a target is unknown', async () => {
    const { client, send } = mockClient({ fixes });
    const targets = [{ questionNumber: '1', stepId: 'S02', issues: ['잘못된 그림'] }];

    const corrected = await repairGeneratedFigures(client, { ...request, targets, generated: generatedFixture() });

    expect(corrected).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
