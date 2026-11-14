import { z } from 'zod';
import { GraphLinkSchema, StepBookletSchema } from '../shared/contracts.ts';

const ReadStepSchema = z.object({ id: z.string(), text: z.string(), after: z.array(z.string()), branch: z.string().nullable() });
export const ReadingSchema = z.object({
  coverage: z.object({ pageCount: z.number().nullable(), detectedQuestionCount: z.number().nullable(), unreadableQuestionNumbers: z.array(z.string()), complete: z.boolean() }),
  questions: z.array(z.object({
    number: z.string(), printedNumberPrefix: z.string().nullable(), problemText: z.string(), variables: z.array(z.string()),
    handwritingStatus: z.enum(['read', 'unreadable', 'missing']),
    observedSteps: z.array(ReadStepSchema), visualObservations: z.array(z.string()), retrievalTerms: z.array(z.string()), uncertainties: z.array(z.string()),
  })),
  limitations: z.array(z.string()),
});
export type Reading = z.infer<typeof ReadingSchema>;

export function usesHandwriting(mode: 'solve' | 'supplement', question: Reading['questions'][number]): boolean {
  return mode === 'supplement' && (question.handwritingStatus !== 'missing' || question.observedSteps.length > 0);
}

const PointSchema = z.object({ x: z.number(), y: z.number() });
const ModelGraphSchema = z.object({
  title: z.string(), variable: z.string(), qualitative: z.boolean(),
  xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number(),
  xLabel: z.string(), yLabel: z.string(),
  curves: z.array(z.object({ label: z.string(), expression: z.string(), color: z.enum(['blue', 'brown', 'gray']), from: z.number(), to: z.number(), dashed: z.boolean() })),
  points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string(), open: z.boolean() })),
  verticals: z.array(z.object({ x: z.number(), label: z.string() })),
  horizontals: z.array(z.object({ y: z.number(), label: z.string() })),
  arrows: z.array(z.object({ from: PointSchema, to: PointSchema, label: z.string() })),
  shades: z.array(z.object({ label: z.string(), color: z.enum(['blue', 'brown', 'gray']), polygon: z.array(PointSchema) })),
  explanation: z.string(),
});
const ModelGraphLinkSchema = GraphLinkSchema.extend({
  anchorLabels: z.array(GraphLinkSchema.shape.anchorLabels.unwrap().element).max(3).nullable(),
});
const booklet = StepBookletSchema.shape;
const ModelBookletSchema = z.object({
  group: booklet.group.unwrap().nullable(),
  equationRole: booklet.equationRole.unwrap().nullable(),
  keyPhrases: booklet.keyPhrases.unwrap().nullable(),
  equationNote: booklet.equationNote.unwrap().nullable(),
  takeaway: booklet.takeaway.unwrap().nullable(),
  referenceTip: booklet.referenceTip.unwrap().nullable(),
  termNotes: booklet.termNotes.unwrap().nullable(),
  graphLinks: z.array(ModelGraphLinkSchema).max(3).nullable(),
  figure: booklet.figure.unwrap().nullable(),
  zoom: booklet.zoom.unwrap().nullable(),
  zoomNote: booklet.zoomNote.unwrap().nullable(),
  table: booklet.table.unwrap().nullable(),
});

const GeneratedStepSchema = z.object({
  id: z.string(), after: z.array(z.string()), branch: z.string().nullable(), sourceIssueRefs: z.array(z.string()),
  sourceConflict: z.string().nullable(), booklet: ModelBookletSchema.nullable(),
  title: z.string(), explanation: z.string(), latex: z.string(), originalStep: z.string(), evidence: z.string(), graph: ModelGraphSchema.nullable(),
  figureRecipe: z.string().nullable().optional(),
});

const GeneratedQuestionSchema = z.object({
  number: z.string(), problemText: z.string(), firstDecision: z.string(), variables: z.array(z.string()),
  observedOrder: z.array(z.string()), steps: z.array(GeneratedStepSchema),
  answer: z.string(), uncertainties: z.array(z.string()),
  checks: z.object({ math: z.array(z.string()), sequence: z.array(z.string()), graph: z.array(z.string()) }),
});

export const GeneratedResultSchema = z.object({
  summary: z.string(),
  questions: z.array(GeneratedQuestionSchema),
  references: z.array(z.object({ id: z.string(), title: z.string(), reason: z.string() })),
  limitations: z.array(z.string()),
});
export type GeneratedResult = z.infer<typeof GeneratedResultSchema>;

const WriterStepSchema = GeneratedStepSchema.omit({ graph: true }).extend({ figureRecipe: z.string().nullable() });
export const WriterResultSchema = GeneratedResultSchema.extend({
  questions: z.array(GeneratedQuestionSchema.extend({ steps: z.array(WriterStepSchema) })),
});
