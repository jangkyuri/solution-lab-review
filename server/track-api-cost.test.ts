import { expect, it, vi } from 'vitest';
import { trackApiCost } from './track-api-cost.ts';

it('records returned usage when local structured output parsing fails', async () => {
  const response = Response.json({ model: 'gpt-6.1-sol', service_tier: 'default',
    usage: { input_tokens: 100, output_tokens: 20 } });
  const failedParse = new SyntaxError('Malformed structured output');
  const rejectOnRead: PromiseLike<never>['then'] = (onFulfilled, onRejected) =>
    Promise.reject(failedParse).then(onFulfilled, onRejected);
  const pending = {
    asResponse: async () => response,
    then: rejectOnRead,
  };
  const record = vi.fn();

  await expect(trackApiCost(() => pending, record)).rejects.toBe(failedParse);

  expect(record).toHaveBeenCalledExactlyOnceWith({ requests: 1, inputTokens: 100, cachedInputTokens: 0,
    outputTokens: 20, estimatedUsd: 0.0004, status: 'estimated' });
});
