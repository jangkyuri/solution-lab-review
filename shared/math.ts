import { z } from 'zod';

export const CheckMathRequestSchema = z.object({
  operation: z.enum(['simplify', 'derivative', 'integral', 'equivalence']),
  expression: z.string().trim().min(1).max(300),
  variable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,11}$/u).default('x'),
  comparison: z.string().max(300).optional(),
  lower: z.number().finite().optional(),
  upper: z.number().finite().optional(),
});
export type CheckMathRequest = z.infer<typeof CheckMathRequestSchema>;
export type CheckMathInput = z.input<typeof CheckMathRequestSchema>;

export const CheckMathResponseSchema = z.object({
  operation: CheckMathRequestSchema.shape.operation,
  expression: z.string(), variable: z.string(), result: z.string(), latex: z.string(),
  status: z.enum(['computed', 'verified', 'different', 'undetermined']),
  details: z.string(),
});
export type CheckMathResponse = z.infer<typeof CheckMathResponseSchema>;
