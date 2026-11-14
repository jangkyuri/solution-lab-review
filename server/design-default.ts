import { z } from 'zod';
import { DesignReferenceSchema } from '../shared/design-reference.ts';
import type { DesignReference } from '../shared/design-reference.ts';
import type { Store } from './store.ts';

const MetadataRowSchema = z.object({ metadata: z.string() });

export function getDefaultDesignReference(store: Store): DesignReference | null {
  const row = store.database.prepare(
    'SELECT r.metadata FROM design_reference_default d JOIN design_references r ON r.id = d.reference_id WHERE d.slot = 1',
  ).get();
  return row ? DesignReferenceSchema.parse(JSON.parse(MetadataRowSchema.parse(row).metadata)) : null;
}
