import { z } from 'zod';

export const PdfDesignSchema = z.object({
  fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]),
  margins: z.enum(['compact', 'standard', 'wide']),
  stepLayout: z.enum(['flow', 'separate']),
  template: z.literal('baeksin-v16').optional(),
  sourceLayout: z.literal('stacked-reference').optional(),
}).strict();

export type PdfDesign = z.infer<typeof PdfDesignSchema>;

export const LEGACY_PDF_DESIGN = {
  fontSize: 11,
  margins: 'standard',
  stepLayout: 'flow',
} as const satisfies PdfDesign;

export const BAEKSIN_V16_PDF_DESIGN = {
  ...LEGACY_PDF_DESIGN,
  template: 'baeksin-v16',
} as const satisfies PdfDesign;

export const DEFAULT_PDF_DESIGN = {
  ...BAEKSIN_V16_PDF_DESIGN,
  sourceLayout: 'stacked-reference',
} as const satisfies PdfDesign;
