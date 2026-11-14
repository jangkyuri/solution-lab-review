import { z } from 'zod';
import type { KnowledgeProblem } from '../shared/knowledge.ts';

export class KnowledgeError extends Error {
  readonly name = 'KnowledgeError';
  readonly code: 'integrity' | 'schema' | 'references' | 'missing';
  constructor(code: 'integrity' | 'schema' | 'references' | 'missing', message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

const StepSource = z.looseObject({
  stepId: z.string().min(1), sourceEvidence: z.string(), mathematicalContent: z.string(),
  role: z.string(), after: z.array(z.string()), branch: z.string().optional(),
});
const GapSource = z.looseObject({
  gapId: z.string().min(1), atStep: z.string().min(1), kind: z.string().min(1), sourceEvidence: z.string(),
  studentObstacle: z.string(), minimumSupplement: z.string(), verification: z.string(),
});
const LinkSource = z.union([
  z.looseObject({ fromStep: z.string(), toStep: z.string(), sourceEvidence: z.string(), meaning: z.string() })
    .transform((raw) => ({ fromStep: raw.fromStep, toStep: raw.toStep, atStep: null, description: `${raw.sourceEvidence}\n${raw.meaning}`, raw })),
  z.looseObject({ fromStep: z.string(), toStep: z.string(), sourceEvidence: z.string(), observedLink: z.string() })
    .transform((raw) => ({ fromStep: raw.fromStep, toStep: raw.toStep, atStep: null, description: `${raw.sourceEvidence}\n${raw.observedLink}`, raw })),
  z.looseObject({ atStep: z.string(), from: z.string(), to: z.string(), mark: z.string() })
    .transform((raw) => ({ fromStep: null, toStep: null, atStep: raw.atStep, description: `${raw.from} → ${raw.to}\n${raw.mark}`, raw })),
  z.looseObject({ fromStep: z.string(), toStep: z.string(), sourceEvidence: z.string() })
    .transform((raw) => ({ fromStep: raw.fromStep, toStep: raw.toStep, atStep: null, description: raw.sourceEvidence, raw })),
  z.looseObject({ fromStep: z.string(), toStep: z.string(), sourceObservation: z.string() })
    .transform((raw) => ({ fromStep: raw.fromStep, toStep: raw.toStep, atStep: null, description: raw.sourceObservation, raw })),
  z.looseObject({ stepIds: z.array(z.string()).min(1), sourceEvidence: z.string(), role: z.string() })
    .transform((raw) => ({ fromStep: null, toStep: null, atStep: null, description: `관련 단계: ${raw.stepIds.join(', ')}\n${raw.sourceEvidence}\n${raw.role}`, referencedSteps: raw.stepIds, raw })),
  z.looseObject({ steps: z.array(z.string()).min(1), observation: z.string() })
    .transform((raw) => ({ fromStep: null, toStep: null, atStep: null, description: `관련 단계: ${raw.steps.join(', ')}\n${raw.observation}`, referencedSteps: raw.steps, raw })),
]).refine(({ raw }) => [
  'fromStep' in raw || 'toStep' in raw, 'atStep' in raw, 'stepIds' in raw, 'steps' in raw,
].filter(Boolean).length === 1, { message: '그래프 연결에 서로 다른 참조 형식을 섞을 수 없습니다.' });
const SampleId = z.string().regex(/^(?:P\d+|M1B01-Q\d+)$/u);
const CoreSource = z.looseObject({
  track: z.literal('original_core'), problems: z.array(z.looseObject({
    sampleId: SampleId, sourceId: z.string().min(1), centralArgument: z.string(),
    steps: z.array(StepSource).min(1), graphEquationLinks: z.array(LinkSource),
    preserve: z.array(z.string()), sourceIssueRefs: z.array(z.string()),
  })),
});
const SupplementSource = z.looseObject({
  track: z.literal('supplement_needs'), problems: z.array(z.looseObject({
    sampleId: SampleId, items: z.array(GapSource), needsUserInput: z.array(z.string()),
  })),
});
type CoreDocument = z.infer<typeof CoreSource>;
type GapDocument = z.infer<typeof SupplementSource>;

export type KnowledgeDocument = { readonly path: string; readonly value: unknown };

function validateProblem(problem: KnowledgeProblem): void {
  const steps = new Set(problem.steps.map((step) => step.stepId));
  const gaps = new Set(problem.supplements.map((gap) => gap.gapId));
  if (steps.size !== problem.steps.length || gaps.size !== problem.supplements.length) {
    throw new KnowledgeError('references', '풀이 기록의 단계 또는 보충 식별자가 중복되었습니다.');
  }
  const stepPrefix = `${problem.sampleId}-S`;
  const gapPrefix = `${problem.sampleId}-G`;
  for (const step of problem.steps) {
    if (!step.stepId.startsWith(stepPrefix) || step.after.some((prior) => !steps.has(prior))) {
      throw new KnowledgeError('references', '풀이 단계가 다른 문항 또는 없는 단계에 연결되었습니다.');
    }
  }
  for (const gap of problem.supplements) {
    if (!gap.gapId.startsWith(gapPrefix) || !steps.has(gap.atStep)) {
      throw new KnowledgeError('references', '보충 설명이 다른 문항 또는 없는 단계에 연결되었습니다.');
    }
  }
  if (problem.sourceIssueRefs.some((gap) => !gaps.has(gap))) {
    throw new KnowledgeError('references', '원문 주의 사항의 보충 참조가 끊어졌습니다.');
  }
  for (const link of problem.graphEquationLinks) {
    if ([link.atStep, link.fromStep, link.toStep].some((id) => id !== null && !steps.has(id))) {
      throw new KnowledgeError('references', '그래프와 식의 단계 참조가 끊어졌습니다.');
    }
  }
  const remaining = new Set(steps);
  while (remaining.size > 0) {
    const ready = problem.steps.filter((step) => remaining.has(step.stepId) && step.after.every((id) => !remaining.has(id)));
    if (ready.length === 0) throw new KnowledgeError('references', '풀이 단계의 의존 관계에 순환이 있습니다.');
    for (const step of ready) remaining.delete(step.stepId);
  }
}

export function normalizeKnowledge(documents: readonly KnowledgeDocument[]): KnowledgeProblem[] {
  const originals: CoreDocument[] = [];
  const supplements: GapDocument[] = [];
  const titles = new Map<string, string>();
  for (const document of documents) {
    const path = document.path;
    if (/\/목록\/.*표본.*선정\.json$/u.test(path)) {
      const index = z.object({ samples: z.array(z.object({ sampleId: z.string(), title: z.string() })) }).parse(document.value);
      for (const sample of index.samples) titles.set(sample.sampleId, sample.title);
    }
    if (!/^수학_손풀이_학습\/(?:문항별|확대01)\/분리기록\//u.test(path)) continue;
    if (/\/원본핵심_.*\.json$/u.test(path)) originals.push(CoreSource.parse(document.value));
    else if (/\/보충필요_.*\.json$/u.test(path)) supplements.push(SupplementSource.parse(document.value));
    else throw new KnowledgeError('schema', '새로운 분리 기록 형식은 연결 규칙을 확인한 뒤 가져올 수 있습니다.');
  }
  const gapMap = new Map<string, { readonly problem: GapDocument['problems'][number]; readonly metadata: Record<string, unknown> }>();
  for (const document of supplements) {
    const { problems, ...metadata } = document;
    for (const problem of problems) {
      if (gapMap.has(problem.sampleId)) throw new KnowledgeError('references', '같은 문항의 보충 기록이 중복되었습니다.');
      gapMap.set(problem.sampleId, { problem, metadata });
    }
  }
  const seen = new Set<string>();
  const problems: KnowledgeProblem[] = [];
  for (const document of originals) {
    const { problems: records, ...metadata } = document;
    for (const record of records) {
      if (seen.has(record.sampleId)) throw new KnowledgeError('references', '같은 문항의 원본 핵심 기록이 중복되었습니다.');
      seen.add(record.sampleId);
      const supplement = gapMap.get(record.sampleId);
      if (!supplement) throw new KnowledgeError('references', '원본 핵심에 대응하는 보충 기록이 없습니다.');
      const stepIds = new Set(record.steps.map((step) => step.stepId));
      for (const link of record.graphEquationLinks) {
        if ('referencedSteps' in link && link.referencedSteps.some((id) => !stepIds.has(id))) {
          throw new KnowledgeError('references', '그래프와 식의 단계 참조가 끊어졌습니다.');
        }
      }
      const problem: KnowledgeProblem = {
        sampleId: record.sampleId, sourceId: record.sourceId, title: titles.get(record.sampleId) ?? record.sampleId,
        centralArgument: record.centralArgument,
        steps: record.steps.map((raw) => ({ ...raw, branch: raw.branch ?? null, raw })),
        supplements: supplement.problem.items.map((raw) => ({ ...raw, raw })),
        graphEquationLinks: record.graphEquationLinks.map(({ fromStep, toStep, atStep, description, raw }) => ({ fromStep, toStep, atStep, description, raw })), preserve: record.preserve, sourceIssueRefs: record.sourceIssueRefs,
        needsUserInput: supplement.problem.needsUserInput,
        raw: { original: { ...record, graphEquationLinks: record.graphEquationLinks.map((link) => link.raw) }, supplement: supplement.problem, originalRecord: metadata, supplementRecord: supplement.metadata },
      };
      validateProblem(problem);
      problems.push(problem);
    }
  }
  if (problems.length === 0 || gapMap.size !== problems.length) throw new KnowledgeError('references', '원본 핵심과 보충 기록의 문항 구성이 맞지 않습니다.');
  return problems.sort((left, right) => left.sampleId.localeCompare(right.sampleId, 'en', { numeric: true }));
}
