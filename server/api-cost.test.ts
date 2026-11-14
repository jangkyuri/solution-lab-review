import { describe, expect, it } from 'vitest';
import { addApiCost, measureApiCost } from './api-cost.ts';

describe('API cost', () => {
  it('prices ordinary input, reads, writes by lifetime, and all output', () => {
    const cost = measureApiCost({ model: 'gpt-6.1-sol', service_tier: 'default', usage: {
      input_tokens: 10_000, output_tokens: 1_000, total_tokens: 11_000,
      input_tokens_details: { cached_tokens: 1_000, cache_write_tokens: 5_000,
        cache_write_tokens_details: { ttl_30m_tokens: 3_000, ttl_12h_tokens: 2_000 } },
      output_tokens_details: { reasoning_tokens: 600 },
    } });
    expect(cost).toMatchObject({ requests: 1, inputTokens: 10_000, cachedInputTokens: 1_000,
      outputTokens: 1_000, status: 'estimated' });
    expect(cost.estimatedUsd).toBeCloseTo(0.0356, 10);
  });

  it('applies long-context rates to the full request only above 272,000 input tokens', () => {
    const measure = (inputTokens: number) => measureApiCost({ model: 'gpt-6.1-sol', service_tier: 'default', usage: {
      input_tokens: inputTokens, output_tokens: 1_000,
      input_tokens_details: { cached_tokens: 10_000, cache_write_tokens: 250_000 },
    } });
    expect(measure(272_000).estimatedUsd).toBeCloseTo(0.66, 10);
    expect(measure(272_001).estimatedUsd).toBeCloseTo(1.315004, 10);
  });

  it('uses the model and processing tier reported by the API', () => {
    const cost = measureApiCost({ model: 'gpt-6-luna', service_tier: 'fast', usage: {
      input_tokens: 10_000, output_tokens: 1_000,
      input_tokens_details: { cached_tokens: 1_000, cache_write_tokens: 5_000 },
    } });
    expect(cost.estimatedUsd).toBeCloseTo(0.00307, 10);
  });

  it('marks costs based on missing cache accounting and tier as partial', () => {
    const cost = measureApiCost({ model: 'gpt-6.1-sol', usage: {
      input_tokens: 5_000, output_tokens: 1_000, input_tokens_details: { cached_tokens: 1_000 },
    } });
    expect(cost.status).toBe('partial');
    expect(cost.estimatedUsd).toBeCloseTo(0.0181, 10);
  });

  it('keeps token counts for unpriced requests and merges missing charges without treating them as zero', () => {
    const priced = measureApiCost({ model: 'gpt-6.1-sol', service_tier: 'default', usage: {
      input_tokens: 20, output_tokens: 10, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    } });
    const unknown = measureApiCost({ model: 'unknown-model', service_tier: 'default', usage: {
      input_tokens: 2_000, output_tokens: 500, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 },
    } });
    expect(unknown).toMatchObject({ status: 'unavailable', estimatedUsd: null, inputTokens: 2_000 });
    expect(addApiCost(undefined, measureApiCost())).toMatchObject({ requests: 1, estimatedUsd: null, status: 'unavailable' });
    expect(addApiCost(unknown, measureApiCost())).toMatchObject({ requests: 2, estimatedUsd: null, status: 'unavailable' });
    const combined = addApiCost(addApiCost(priced, unknown), measureApiCost());
    expect(combined).toMatchObject({ requests: 3, inputTokens: 2_020, cachedInputTokens: 100, outputTokens: 510, status: 'partial' });
    expect(combined.estimatedUsd).toBeCloseTo(0.00014, 10);
  });

  it('reports conflicting cache counts and an unpriced service tier as unavailable', () => {
    const usage = { input_tokens: 100, output_tokens: 10,
      input_tokens_details: { cached_tokens: 50, cache_write_tokens: 70 } };
    expect(measureApiCost({ model: 'gpt-6.1-sol', service_tier: 'default', usage }).estimatedUsd).toBeNull();
    expect(measureApiCost({ model: 'gpt-6.1-sol', service_tier: 'scale', usage: {
      ...usage, input_tokens_details: { cached_tokens: 50, cache_write_tokens: 30 },
    } }).estimatedUsd).toBeNull();
  });
});
