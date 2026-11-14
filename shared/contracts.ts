import { z } from 'zod';
import { DesignReferenceSchema } from './design-reference.ts';
import { PdfDesignSchema } from './pdf-design.ts';

export const ModeSchema = z.enum(['solve', 'supplement']);
export type Mode = z.infer<typeof ModeSchema>;
export const MAX_JOB_INSTRUCTION_LENGTH = 10_000;
export const StatusSchema = z.enum(['draft', 'running', 'needs_review', 'awaiting_next', 'ready', 'failed', 'approved']);
export const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const CurveSchema = z.object({
  label: z.string(), expression: z.string(), color: z.enum(['blue', 'brown', 'gray']),
  from: z.number(), to: z.number(), dashed: z.boolean(), samples: z.array(PointSchema),
  segments: z.array(z.array(PointSchema)).default([]),
});
export const GraphSchema = z.object({
  title: z.string(), xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number(),
  xLabel: z.string(), yLabel: z.string(), curves: z.array(CurveSchema),
  points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string(), open: z.boolean() })),
  verticals: z.array(z.object({ x: z.number(), label: z.string() })),
  explanation: z.string(), variable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,15}$/u).default('x'),
  qualitative: z.boolean().default(false),
  horizontals: z.array(z.object({ y: z.number().finite(), label: z.string() })).default([]),
  arrows: z.array(z.object({ from: PointSchema, to: PointSchema, label: z.string() })).default([]),
  shades: z.array(z.object({ label: z.string(), color: z.enum(['blue', 'brown', 'gray']), polygon: z.array(PointSchema).min(3) })).default([]),
});
export type Graph = z.infer<typeof GraphSchema>;

export const GraphLinkSchema = z.object({
  anchors: z.array(PointSchema).min(1).max(3),
  anchorLabels: z.array(z.string().max(80)).min(1).max(3).optional(),
  latex: z.string().min(1).max(240), note: z.string().max(100),
  color: z.enum(['blue', 'brown']),
});
export type GraphLink = z.infer<typeof GraphLinkSchema>;

export const StepBookletSchema = z.object({
  group: z.string().regex(/^[A-Z]$/u).optional(),
  equationRole: z.enum(['normal', 'key']).optional(),
  keyPhrases: z.array(z.string().min(1).max(120)).max(2).optional(),
  equationNote: z.string().max(600).optional(),
  takeaway: z.string().max(600).optional(),
  referenceTip: z.string().max(500).optional(),
  termNotes: z.array(z.object({
    term: z.string().max(120), note: z.string().max(120), color: z.enum(['blue', 'brown']),
  })).max(3).optional(),
  graphLinks: z.array(GraphLinkSchema).max(3).optional(),
  figure: z.enum(['side', 'wide', 'small']).optional(),
  zoom: z.object({
    xMin: z.number().finite(), xMax: z.number().finite(), yMin: z.number().finite(), yMax: z.number().finite(),
  }).optional(),
  zoomNote: z.string().max(120).optional(),
  table: z.array(z.array(z.string().max(120)).min(2).max(3)).min(1).max(6).optional(),
});
export type StepBooklet = z.infer<typeof StepBookletSchema>;
export const StepSchema = z.object({
  title: z.string(), explanation: z.string(), latex: z.string(), originalStep: z.string(),
  evidence: z.string(), graph: GraphSchema.nullable(),
  figureRecipe: z.string().min(1).max(1_000_000).nullable().optional(),
  id: z.string().default(''), after: z.array(z.string()).default([]),
  branch: z.string().nullable().default(null), sourceIssueRefs: z.array(z.string()).default([]),
  sourceConflict: z.string().nullable().default(null),
  booklet: StepBookletSchema.optional(),
});
export const QuestionSchema = z.object({
  number: z.string(), problemText: z.string(), firstDecision: z.string(),
  variables: z.array(z.string()), observedOrder: z.array(z.string()), steps: z.array(StepSchema),
  answer: z.string(), uncertainties: z.array(z.string()),
  checks: z.object({ math: z.array(z.string()), sequence: z.array(z.string()), graph: z.array(z.string()) }),
});
export type Question = z.infer<typeof QuestionSchema>;
export const ResultSchema = z.object({
  summary: z.string(), questions: z.array(QuestionSchema),
  references: z.array(z.object({ id: z.string(), title: z.string(), reason: z.string() })),
  limitations: z.array(z.string()),
  productionVersion: z.literal('hand-solution-v1').optional(),
  provenance: z.object({
    snapshotId: z.string(), capturedAt: z.string(), sampleIds: z.array(z.string()),
    exampleJobIds: z.array(z.string()), mode: ModeSchema,
    evidenceStatus: z.literal('observed_not_teacher_approved'),
  }).nullable().default(null),
});
export type SolutionResult = z.infer<typeof ResultSchema>;
export const SourceFileSchema = z.object({
  id: z.string(), name: z.string(), mimeType: z.string(), size: z.number(),
  role: z.enum(['exam', 'handwriting']), url: z.string(),
});
export const OriginalProblemSchema = z.object({
  questionNumber: z.string().min(1).max(100), fileId: z.string().min(1).max(200),
  page: z.number().int().positive().max(10_000),
  trim: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative(), z.number().finite().nonnegative()]),
  widthBp: z.number().finite().positive().max(595.2756),
}).strict();
export type OriginalProblem = z.infer<typeof OriginalProblemSchema>;
export const OriginalProblemsSchema = z.array(OriginalProblemSchema).max(40).refine(
  (items) => new Set(items.map(item => item.questionNumber)).size === items.length,
  { message: '문항별 원본 연결은 하나만 지정할 수 있습니다.' },
);
export const QUESTION_APPROVAL_BATCH_SIZE = 4;
const ApiCostSchema = z.object({
  requests: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedUsd: z.number().finite().nonnegative().nullable(),
  status: z.enum(['estimated', 'partial', 'unavailable']),
});
export type ApiCost = z.infer<typeof ApiCostSchema>;
const QuestionProgressSchema = z.object({
  questionNumbers: z.array(z.string().min(1)).min(1),
  completedCount: z.number().int().nonnegative(),
  authorizedCount: z.number().int().positive().optional(),
}).refine(progress => progress.completedCount <= progress.questionNumbers.length
  && new Set(progress.questionNumbers).size === progress.questionNumbers.length
  && (progress.authorizedCount === undefined || (progress.completedCount <= progress.authorizedCount
    && progress.authorizedCount <= progress.questionNumbers.length
    && progress.authorizedCount - progress.completedCount <= QUESTION_APPROVAL_BATCH_SIZE)));
export const JobSchema = z.object({
  id: z.string(), title: z.string(), subject: z.string(), mode: ModeSchema, status: StatusSchema,
  inputText: z.string(), teacherText: z.string(), instruction: z.string(), reviewNote: z.string(),
  createdAt: z.string(), updatedAt: z.string(), files: z.array(SourceFileSchema),
  result: ResultSchema.nullable(), error: z.string().nullable(), model: z.string().nullable(),
  progress: QuestionProgressSchema.optional(),
  reviewIssues: z.array(z.string().min(1)).min(1).optional(),
  apiCost: ApiCostSchema.optional(),
  questionApiCosts: z.record(z.string(), ApiCostSchema).optional(),
  readingApiCost: ApiCostSchema.optional(),
  pdfDesign: PdfDesignSchema.optional(),
  originalProblems: OriginalProblemsSchema.optional(),
  initialDesign: z.object({
    referenceId: DesignReferenceSchema.shape.id,
    title: DesignReferenceSchema.shape.title,
    curveColor: DesignReferenceSchema.shape.curveColor,
  }).optional(),
});
export type Job = z.infer<typeof JobSchema>;
export function hasRemainingQuestions(job: Job): boolean {
  return job.progress !== undefined && job.progress.completedCount < job.progress.questionNumbers.length;
}
export type SourceFile = z.infer<typeof SourceFileSchema>;
export const JobPatchSchema = z.object({
  reviewNote: z.string().max(30000).optional(), result: ResultSchema.optional(),
  title: z.string().min(1).max(160).optional(),
  pdfDesign: PdfDesignSchema.optional(),
  originalProblems: OriginalProblemsSchema.optional(),
});
export const CatalogEntrySchema = z.object({
  id: z.string(), title: z.string(), subject: z.string(), path: z.string(), url: z.string(),
  mimeType: z.string(), sizeBytes: z.number(), stage: z.string(), contentReviewed: z.boolean(),
  localPath: z.string().nullable(), sampleId: z.string().nullable(), sampleStage: z.string().nullable(),
  classificationBasis: z.string(), classificationStatus: z.string(),
  sizeDuplicateCandidateGroup: z.string().nullable(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export const CaseSchema = z.object({
  id: z.string(), title: z.string(), subject: z.string(), sourceJobId: z.string(),
  sourceType: z.enum(['teacher_handwriting', 'approved_generated', 'approved_supplement']),
  problemText: z.string(), teacherFlow: z.array(z.string()), graphLinks: z.array(z.string()),
  reviewNote: z.string(), createdAt: z.string(),
});
export type ApprovedCase = z.infer<typeof CaseSchema>;
export const BootstrapSchema = z.object({
  jobs: z.array(JobSchema), catalogCount: z.number(),
  cases: z.array(CaseSchema), apiConfigured: z.boolean(), model: z.string(),
  criteria: z.object({ text: z.string(), sourcePath: z.string() }),
  defaultDesignTitle: z.string().nullable().optional(),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;
export const LibrarySchema = z.object({ entries: z.array(CatalogEntrySchema), total: z.number(), cases: z.array(CaseSchema) });
