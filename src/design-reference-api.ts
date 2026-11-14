import ky from 'ky';
import { DesignReferenceDefaultSchema, DesignReferenceListSchema, DesignReferenceSchema } from '../shared/design-reference';
import type { DesignReferencePatch } from '../shared/design-reference';
import { DesignReferenceAnalysisSchema } from '../shared/design-reference-analysis';

const client = ky.create({ prefix: '/api', retry: 0, timeout: 30_000 });
const collection = 'design-references';
const library = async (signal?: AbortSignal) => DesignReferenceListSchema.parse(
  await client.get(collection, signal ? { signal } : {}).json(),
);

export const designReferenceApi = {
  library,
  list: async (signal?: AbortSignal) => (await library(signal)).references,
  setDefault: async (referenceId: string | null) => DesignReferenceDefaultSchema.parse(
    await client.put(`${collection}/default`, { json: { referenceId } }).json(),
  ),
  create: async (body: FormData) => DesignReferenceSchema.parse(await client.post(collection, { body }).json()),
  update: async (id: string, json: DesignReferencePatch) => DesignReferenceSchema.parse(
    await client.patch(`${collection}/${encodeURIComponent(id)}`, { json }).json(),
  ),
  analyze: async (id: string, signal: AbortSignal) => DesignReferenceAnalysisSchema.parse(
    await client.post(`${collection}/${encodeURIComponent(id)}/analyze`, { signal, timeout: 120_000 }).json(),
  ),
};
