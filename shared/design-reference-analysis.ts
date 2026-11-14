import { z } from 'zod';
import { DesignCurveColorSchema } from './design-reference.ts';
import { PdfDesignSchema } from './pdf-design.ts';

export const DesignReferenceAnalysisSchema = z.object({
  note: z.string().trim().min(1).max(1800),
  pdfDesign: PdfDesignSchema.omit({ template: true, sourceLayout: true }).nullable(),
  curveColor: DesignCurveColorSchema.nullable(),
}).strict();

export type DesignReferenceAnalysis = z.infer<typeof DesignReferenceAnalysisSchema>;
