import { z } from 'zod';

const RawSchema = z.record(z.string(), z.unknown());
export const KnowledgeStepSchema = z.object({
  stepId: z.string(), sourceEvidence: z.string(), mathematicalContent: z.string(),
  role: z.string(), after: z.array(z.string()), branch: z.string().nullable(), raw: RawSchema,
});
export const KnowledgeSupplementSchema = z.object({
  gapId: z.string(), atStep: z.string(), kind: z.string(), sourceEvidence: z.string(),
  studentObstacle: z.string(), minimumSupplement: z.string(), verification: z.string(), raw: RawSchema,
});
export const KnowledgeGraphLinkSchema = z.object({
  fromStep: z.string().nullable(), toStep: z.string().nullable(), atStep: z.string().nullable(),
  description: z.string(), raw: RawSchema,
});
export const KnowledgeProblemSchema = z.object({
  sampleId: z.string(), sourceId: z.string(), title: z.string(), centralArgument: z.string(),
  steps: z.array(KnowledgeStepSchema), supplements: z.array(KnowledgeSupplementSchema),
  graphEquationLinks: z.array(KnowledgeGraphLinkSchema), preserve: z.array(z.string()),
  sourceIssueRefs: z.array(z.string()), needsUserInput: z.array(z.string()), raw: RawSchema,
});
export const KnowledgeSummarySchema = z.object({
  snapshotId: z.string(), capturedAt: z.string(), recordCount: z.number().int(),
  problemCount: z.number().int(), stepCount: z.number().int(), graphLinkCount: z.number().int(),
  supplementCount: z.number().int(), sourcePath: z.string(), teacherApproval: z.literal('not_inferred'),
});
export const KnowledgeLibrarySchema = z.object({
  summary: KnowledgeSummarySchema, problems: z.array(KnowledgeProblemSchema), warning: z.string().nullable(),
});
export type KnowledgeStep = Readonly<z.infer<typeof KnowledgeStepSchema>>;
export type KnowledgeSupplement = Readonly<z.infer<typeof KnowledgeSupplementSchema>>;
export type KnowledgeProblem = Readonly<z.infer<typeof KnowledgeProblemSchema>>;
export type KnowledgeSummary = Readonly<z.infer<typeof KnowledgeSummarySchema>>;
export type KnowledgeLibrary = Readonly<z.infer<typeof KnowledgeLibrarySchema>>;
