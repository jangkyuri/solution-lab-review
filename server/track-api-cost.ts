import type { ApiCost } from '../shared/contracts.ts';
import { measureApiCost } from './api-cost.ts';

type ApiRequest<T> = PromiseLike<T> & { readonly asResponse?: () => Promise<Response> };

export async function trackApiCost<T>(
  request: () => ApiRequest<T>, record: ((cost: ApiCost) => void) | undefined,
): Promise<T> {
  if (!record) return request();
  let raw: Response | undefined;
  let response: T;
  try {
    const pending = request();
    if (pending.asResponse) raw = (await pending.asResponse()).clone();
    response = await pending;
  } catch (error) {
    // A local schema parse can fail after OpenAI has already reported billable usage.
    const observed: unknown = await raw?.json().catch(() => undefined);
    record(measureApiCost(observed));
    throw error;
  }
  void raw?.body?.cancel().catch(() => undefined);
  record(measureApiCost(response));
  return response;
}
