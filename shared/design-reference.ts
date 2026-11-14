import { z } from 'zod';
import { PdfDesignSchema } from './pdf-design.ts';

export const MAX_DESIGN_REFERENCE_BYTES = 20 * 1024 * 1024;
export const DesignCurveColorSchema = z.enum(['blue', 'brown', 'gray']);
export type DesignCurveColor = z.infer<typeof DesignCurveColorSchema>;

export const DesignReferenceSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  note: z.string().max(10_000),
  fileName: z.string().min(1).max(360),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(MAX_DESIGN_REFERENCE_BYTES),
  fileUrl: z.string(),
  pdfDesign: PdfDesignSchema.nullable(),
  curveColor: DesignCurveColorSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DesignReference = z.infer<typeof DesignReferenceSchema>;

export const DesignReferenceDefaultSchema = z.object({ defaultReferenceId: DesignReferenceSchema.shape.id.nullable() });
export const DesignReferenceListSchema = DesignReferenceDefaultSchema.extend({ references: z.array(DesignReferenceSchema) });
export const DesignReferencePatchSchema = DesignReferenceSchema.pick({
  title: true, note: true, pdfDesign: true, curveColor: true,
}).partial().strict();
export type DesignReferencePatch = z.infer<typeof DesignReferencePatchSchema>;
