import { z } from 'zod';
import type { ApiCost } from '../shared/contracts.ts';

// Standard USD per million tokens, checked 2026-11-13.
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/guides/prompt-caching
const rates = {
  'gpt-6.1-sol': { input: 2, read: 0.1, write30m: 2.5, write12h: 5, output: 10 },
  'gpt-6.1-terra': { input: 1, read: 0.05, write30m: 1.25, write12h: 2.5, output: 5 },
  'gpt-6-luna': { input: 0.1, read: 0.01, write30m: 0.125, write12h: 0.25, output: 0.5 },
  'gpt-6-astra': { input: 10, read: 1, write30m: 12.5, write12h: 25, output: 50 },
} as const;

const tokenCount = z.number().int().nonnegative();
const usageResponse = z.object({
  model: z.string().optional(),
  service_tier: z.string().nullish(),
  usage: z.object({
    input_tokens: tokenCount,
    output_tokens: tokenCount,
    total_tokens: tokenCount.optional(),
    input_tokens_details: z.object({
      cached_tokens: tokenCount.optional(),
      cache_write_tokens: tokenCount.optional(),
      cache_write_tokens_details: z.object({ ttl_30m_tokens: tokenCount, ttl_12h_tokens: tokenCount }).optional(),
    }).optional(),
  }),
});

function isPricedModel(model: string | undefined): model is keyof typeof rates {
  return model !== undefined && Object.hasOwn(rates, model);
}

function tierMultiplier(tier: string | null | undefined, model: keyof typeof rates): number | null {
  switch (tier) {
    case undefined:
    case null:
    case 'auto':
    case 'default': return 1;
    case 'flex': return 0.5;
    case 'fast':
    case 'priority': return 2;
    case 'ultrafast': return model === 'gpt-6.1-sol' || model === 'gpt-6-astra' ? 6 : null;
    default: return null;
  }
}

export function measureApiCost(response?: unknown): ApiCost {
  const parsed = usageResponse.safeParse(response);
  const unavailable = { requests: 1, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    estimatedUsd: null, status: 'unavailable' } as const;
  if (!parsed.success) return unavailable;
  const { model, service_tier: tier, usage } = parsed.data;
  const { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: cache } = usage;
  const cachedInputTokens = cache?.cached_tokens ?? 0;
  const counts = { ...unavailable, inputTokens, cachedInputTokens, outputTokens };
  if (!isPricedModel(model)) return counts;
  const multiplier = tierMultiplier(tier, model);
  if (multiplier === null) return counts;

  const breakdown = cache?.cache_write_tokens_details;
  const writes12h = breakdown?.ttl_12h_tokens ?? 0;
  const writes30m = breakdown?.ttl_30m_tokens ?? cache?.cache_write_tokens ?? 0;
  const writes = writes30m + writes12h;
  const ordinary = inputTokens - cachedInputTokens - writes;
  if (ordinary < 0 || (cache?.cache_write_tokens !== undefined && cache.cache_write_tokens !== writes)
    || (usage.total_tokens !== undefined && usage.total_tokens !== inputTokens + outputTokens)) return counts;

  const rate = rates[model];
  const longContext = inputTokens > 272_000;
  const inputCost = ordinary * rate.input + cachedInputTokens * rate.read
    + writes30m * rate.write30m + writes12h * rate.write12h;
  const outputCost = outputTokens * rate.output;
  const estimatedUsd = (inputCost * (longContext ? 2 : 1) + outputCost * (longContext ? 1.5 : 1))
    * multiplier / 1_000_000;
  const cacheUncertain = inputTokens >= 1_024 && (cache?.cached_tokens === undefined
    || (cache.cache_write_tokens === undefined && breakdown === undefined));
  const status = cacheUncertain || tier == null || tier === 'auto' ? 'partial' : 'estimated';
  return { ...counts, estimatedUsd, status };
}

export function addApiCost(previous: ApiCost | undefined, next: ApiCost): ApiCost {
  if (previous === undefined) return next;
  const estimatedUsd = previous.estimatedUsd === null && next.estimatedUsd === null
    ? null : (previous.estimatedUsd ?? 0) + (next.estimatedUsd ?? 0);
  const status = estimatedUsd === null ? 'unavailable'
    : previous.status === 'estimated' && next.status === 'estimated' ? 'estimated' : 'partial';
  return {
    requests: previous.requests + next.requests,
    inputTokens: previous.inputTokens + next.inputTokens,
    cachedInputTokens: previous.cachedInputTokens + next.cachedInputTokens,
    outputTokens: previous.outputTokens + next.outputTokens,
    estimatedUsd,
    status,
  };
}
