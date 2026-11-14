import type { Graph, Question, SolutionResult } from '../shared/contracts.ts';
import { GraphBoundsSchema } from '../shared/graph-design.ts';
import { AppError } from './errors.ts';
import { validateFigureRecipe } from './figure-recipe.ts';
import { validateSolutionStructure } from './generation-validation.ts';
import { prepareGraphs } from './graphs.ts';

const reviewWarning = '수식·조건 또는 단계 연결을 수정하여 이전 검산 기록을 비웠습니다. 수정한 내용과 그래프를 다시 검토해주세요.';
const emptyChecks = (): Question['checks'] => ({ math: [], sequence: [], graph: [] });
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const stepKey = (number: string, id: string): string => JSON.stringify([number, id]);

function reviewInputs(question: Question): unknown {
  return {
    problemText: question.problemText, variables: question.variables, answer: question.answer,
    observedOrder: question.observedOrder,
    steps: question.steps.map((step) => ({
      id: step.id, latex: step.latex, originalStep: step.originalStep.trim(),
      after: step.after, branch: step.branch, sourceIssueRefs: step.sourceIssueRefs,
    })),
  };
}

function withoutClientSamples(graph: Graph): Graph {
  return { ...graph, curves: graph.curves.map((curve) => ({ ...curve, samples: [], segments: [] })) };
}

function graphGeometry(graph: Graph | null): unknown {
  if (!graph) return null;
  const { title, xMin, xMax, yMin, yMax, xLabel, yLabel, curves, ...geometry } = graph;
  return { ...geometry, curves: curves.map(({ color, dashed, samples, segments, ...curve }) => curve) };
}

function retainGraphSamples(graph: Graph, original: Graph): Graph {
  const changedBounds = graph.xMin !== original.xMin || graph.xMax !== original.xMax
    || graph.yMin !== original.yMin || graph.yMax !== original.yMax;
  if (changedBounds && !GraphBoundsSchema.safeParse(graph).success) {
    throw new AppError(400, '그래프 범위를 확인해주세요.');
  }
  return { ...graph, curves: graph.curves.map((curve, index) => ({ ...curve,
    samples: original.curves[index]?.samples ?? [], segments: original.curves[index]?.segments ?? [],
  })) };
}

function appendWarning(existing: readonly string[], message: string): string[] {
  return existing.includes(message) ? [...existing] : [...existing, message];
}

function retainConflictStepIds(previous: SolutionResult | null, edited: SolutionResult): void {
  const editedIds = new Set(edited.questions.flatMap((question) => question.steps.map((step) => stepKey(question.number, step.id))));
  for (const question of previous?.questions ?? []) {
    for (const step of question.steps) {
      if (step.sourceConflict && !editedIds.has(stepKey(question.number, step.id))) {
        throw new AppError(400, '원문 판독을 확인할 단계의 문항 번호와 식별자를 유지해주세요.');
      }
    }
  }
}

/** User edits may change content, while generation evidence remains owned by the server. */
export async function prepareEditedResult(previous: SolutionResult | null, edited: SolutionResult): Promise<SolutionResult> {
  const { productionVersion: _editedVersion, ...content } = edited;
  const productionVersion = previous?.productionVersion;
  const candidate: SolutionResult = {
    ...content, ...(productionVersion ? { productionVersion } : {}),
    provenance: previous?.provenance ?? null, references: previous?.references ?? [],
  };
  retainConflictStepIds(previous, candidate);
  const limitations = new Set(candidate.limitations);
  const previousQuestions = new Map(previous?.questions.map((question) => [question.number, question]) ?? []);
  const pendingGraphs = new Set<string>();
  const pendingRecipes = new Set<string>();
  const questions = candidate.questions.map((question): Question => {
    const oldQuestion = previousQuestions.get(question.number);
    const oldSteps = new Map(oldQuestion?.steps.map((step) => [step.id, step]) ?? []);
    let graphChanged = false;
    let graphPresentationChanged = false;
    let uncertainties = [...question.uncertainties];
    const resolvedWarnings = new Set<string>();
    const steps = question.steps.map((step) => {
      const oldStep = oldSteps.get(step.id);
      const transcriptionChanged = oldStep !== undefined && step.originalStep.trim() !== oldStep.originalStep.trim();
      const oldConflict = oldStep?.sourceConflict ?? null;
      const corrected = transcriptionChanged && step.originalStep.trim().length > 0;
      if (oldConflict && !productionVersion) {
        const warning = `${step.id} 단계 원문 판독 확인이 필요합니다. ${oldConflict}`;
        if (corrected) resolvedWarnings.add(warning);
        else uncertainties = appendWarning(uncertainties, warning);
      }
      const sourceStep = {
        ...step,
        ...(oldStep && oldConflict ? { after: oldStep.after, branch: oldStep.branch } : {}),
        sourceConflict: corrected ? null : oldConflict,
      };
      const oldGraph = oldStep?.graph ?? null;
      const sceneChanged = !same(graphGeometry(step.graph), graphGeometry(oldGraph));
      const recipeChanged = (step.figureRecipe ?? null) !== (oldStep?.figureRecipe ?? null);
      graphChanged ||= sceneChanged || recipeChanged;
      if (step.figureRecipe && recipeChanged) pendingRecipes.add(step.figureRecipe);
      if (step.figureRecipe && oldStep && !recipeChanged && (step.latex !== oldStep.latex || transcriptionChanged)) {
        const recipeWarning = `${step.title || step.id} 단계의 수식 또는 원문 판독이 바뀌었습니다. 기존 그래프가 수정한 풀이와 맞는지 확인해주세요.`;
        if (productionVersion) limitations.add(`${question.number}번 ${recipeWarning}`);
        else uncertainties = appendWarning(uncertainties, recipeWarning);
      }
      if (step.graph && oldStep && !sceneChanged && (step.latex !== oldStep.latex || transcriptionChanged)) {
        const graphWarning = `${step.title || step.id} 단계의 수식 또는 원문 판독이 바뀌어 이전 그래프를 숨겼습니다. 수정한 풀이에 맞는 그래프를 다시 확인해주세요.`;
        if (productionVersion) limitations.add(`${question.number}번 ${graphWarning}`);
        else uncertainties = appendWarning(uncertainties, graphWarning);
        return { ...sourceStep, graph: null };
      }
      if (step.graph && sceneChanged) {
        pendingGraphs.add(stepKey(question.number, step.id));
        return { ...sourceStep, graph: withoutClientSamples(step.graph) };
      }
      if (step.graph && oldGraph) {
        if (same(withoutClientSamples(step.graph), withoutClientSamples(oldGraph))) return { ...sourceStep, graph: oldGraph };
        graphPresentationChanged = true;
        return { ...sourceStep, graph: retainGraphSamples(step.graph, oldGraph) };
      }
      return sourceStep;
    });
    if (resolvedWarnings.size > 0) {
      uncertainties = [...new Set([...uncertainties, ...(oldQuestion?.uncertainties ?? [])])]
        .filter((warning) => !resolvedWarnings.has(warning));
    }
    const mathChanged = !oldQuestion || !same(reviewInputs({ ...question, steps }), reviewInputs(oldQuestion));
    if (mathChanged || graphChanged) {
      if (productionVersion) limitations.add(reviewWarning);
      else uncertainties = appendWarning(uncertainties, reviewWarning);
    }
    const checks = mathChanged || graphChanged ? emptyChecks()
      : graphPresentationChanged ? { ...question.checks, graph: [] } : question.checks;
    return { ...question, steps, uncertainties, checks };
  });
  const prepared: SolutionResult = { ...candidate, questions, limitations: productionVersion ? [...limitations] : candidate.limitations };
  validateSolutionStructure(prepared);
  await Promise.all([...pendingRecipes].map(validateFigureRecipe));
  if (pendingGraphs.size === 0) return prepared;

  // Other existing graphs stay out of the sampler, including graphs beside prose-only edits.
  const samplingInput: SolutionResult = {
    ...prepared,
    questions: prepared.questions.map((question) => ({
      ...question, steps: question.steps.map((step) => ({
        ...step, graph: pendingGraphs.has(stepKey(question.number, step.id)) ? step.graph : null,
      })),
    })),
  };
  const sampled = await prepareGraphs(samplingInput);
  const sampledQuestions = new Map(sampled.questions.map((question) => [question.number, question]));
  return {
    ...prepared, limitations: sampled.limitations,
    questions: prepared.questions.map((question) => {
      const checked = sampledQuestions.get(question.number);
      const checkedSteps = new Map(checked?.steps.map((step) => [step.id, step]) ?? []);
      return {
        ...question, uncertainties: checked?.uncertainties ?? question.uncertainties,
        steps: question.steps.map((step) => pendingGraphs.has(stepKey(question.number, step.id))
          ? { ...step, graph: checkedSteps.get(step.id)?.graph ?? null } : step),
      };
    }),
  };
}
