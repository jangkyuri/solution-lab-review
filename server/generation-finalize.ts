import type { Job, SolutionResult, StepBooklet } from '../shared/contracts.ts';
import { ResultSchema } from '../shared/contracts.ts';
import { HAND_SOLUTION_PRODUCTION_VERSION, withConfirmationMarker } from '../shared/hand-solution-output.ts';
import type { KnowledgeLibrary, KnowledgeProblem } from '../shared/knowledge.ts';
import { AppError } from './errors.ts';
import type { GeneratedResult, Reading } from './generation-schemas.ts';
import { usesHandwriting } from './generation-schemas.ts';
import { preserveReadSequence, validateSolutionStructure, validateStepGraph } from './generation-validation.ts';
import { studentFacingGraph, studentFacingText } from './student-language.ts';

type ModelBooklet = GeneratedResult['questions'][number]['steps'][number]['booklet'];

function normalizeBooklet(booklet: ModelBooklet): StepBooklet | undefined {
  if (booklet === null) return undefined;
  const normalized: StepBooklet = {};
  if (booklet.group) normalized.group = booklet.group;
  if (booklet.equationRole) normalized.equationRole = booklet.equationRole;
  if (booklet.keyPhrases?.length) normalized.keyPhrases = booklet.keyPhrases.map(studentFacingText);
  if (booklet.figure) normalized.figure = booklet.figure;
  if (booklet.zoom) normalized.zoom = booklet.zoom;
  for (const key of ['equationNote', 'takeaway', 'referenceTip', 'zoomNote'] as const) {
    const text = booklet[key]?.trim();
    if (text) normalized[key] = studentFacingText(text);
  }
  const notes = booklet.termNotes?.map(({ term, note, color }) => ({
    term: term.trim(), note: studentFacingText(note).trim(), color,
  })).filter(({ term, note }) => term && note);
  if (notes?.length) normalized.termNotes = notes;
  if (booklet.graphLinks?.length) {
    normalized.graphLinks = booklet.graphLinks.map(({ anchors, anchorLabels, latex, note, color }) => {
      const labels = anchorLabels?.map((label) => studentFacingText(label).trim());
      return {
        anchors, ...(labels?.some(Boolean) ? { anchorLabels: labels } : {}),
        latex: latex.trim(), note: studentFacingText(note).trim(), color,
      };
    });
  }
  if (booklet.table) {
    normalized.table = booklet.table.map((row) => row.map((cell) => studentFacingText(cell).trim()));
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

export function finalizeGeneration(
  generated: GeneratedResult, reading: Reading, mode: Job['mode'],
  knowledge: KnowledgeLibrary, examples: readonly KnowledgeProblem[], readQuestionCount = reading.questions.length,
): SolutionResult {
  const sourceQuestions = new Map(reading.questions.map((question) => [question.number, question]));
  const numbers = generated.questions.map((question) => question.number);
  if (sourceQuestions.size !== reading.questions.length || new Set(numbers).size !== numbers.length || numbers.length !== sourceQuestions.size) {
    throw new AppError(503, '판독한 문항과 작성한 문항의 대응이 맞지 않습니다. 결과를 다시 확인해주세요.');
  }
  const allowed = new Map(examples.filter((example) => /^P\d+$/u.test(example.sampleId)).map((example) => [example.sampleId, example]));
  if (generated.references.some((reference) => !allowed.has(reference.id))) throw new AppError(503, '실제로 참고하지 않은 자료가 결과에 포함되어 다시 확인해야 합니다.');
  const questions = generated.questions.map((question) => {
    const source = sourceQuestions.get(question.number);
    if (!source) throw new AppError(503, '판독에 없던 새 문항이 결과에 포함되었습니다.');
    const supplement = usesHandwriting(mode, source);
    validateStepGraph(question.steps);
    if (supplement && (question.variables.length !== source.variables.length || question.variables.some((variable) => !source.variables.includes(variable)))) {
      throw new AppError(503, '보충 과정에서 원래 미지수가 바뀌어 결과를 보류했습니다.');
    }
    const normalized = question.steps.map(({ booklet, ...step }) => {
      const modelLayout = normalizeBooklet(booklet);
      const layout: StepBooklet | undefined = (step.figureRecipe || step.graph) && !modelLayout?.figure && !modelLayout?.zoom && !modelLayout?.graphLinks?.length
        ? { ...modelLayout, figure: 'wide' }
        : modelLayout;
      return {
        ...step,
        ...(layout ? { booklet: layout } : {}),
        title: studentFacingText(step.title),
        explanation: studentFacingText(step.explanation),
        evidence: studentFacingText(step.evidence),
        sourceIssueRefs: [],
        sourceConflict: supplement && step.sourceConflict ? withConfirmationMarker(studentFacingText(step.sourceConflict)) || null : null,
        graph: step.graph ? studentFacingGraph(step.graph) : null,
      };
    });
    const steps = supplement
      ? preserveReadSequence(source.observedSteps, normalized)
      : normalized.map((step) => ({ ...step, originalStep: '' }));
    const sourceConflicts = new Set(steps.map((step) => step.sourceConflict));
    const uncertainties = [...source.uncertainties, ...question.uncertainties]
      .map((note) => withConfirmationMarker(studentFacingText(note)))
      .filter((note) => note && !sourceConflicts.has(note));
    return {
      ...question, problemText: source.problemText,
      firstDecision: studentFacingText(question.firstDecision),
      variables: supplement ? source.variables : question.variables,
      observedOrder: supplement ? source.observedSteps.map((step) => `${step.id}: ${step.text}`) : [],
      steps,
      uncertainties: [...new Set(uncertainties)],
      checks: {
        math: question.checks.math.map(studentFacingText),
        sequence: question.checks.sequence.map(studentFacingText),
        graph: question.checks.graph.map(studentFacingText),
      },
    };
  });
  const references = [...new Map(generated.references.map((reference) => [reference.id, reference])).values()].map((reference) => ({
    ...reference, title: allowed.get(reference.id)?.title ?? reference.title, reason: studentFacingText(reference.reason),
  }));
  const coverageWarnings: string[] = [];
  if (!reading.coverage.complete || reading.coverage.unreadableQuestionNumbers.length > 0) {
    coverageWarnings.push(`전체 범위 판독이 끝나지 않은 초안입니다. 확인이 필요한 문항: ${reading.coverage.unreadableQuestionNumbers.join(', ') || '범위 미확인'}.`);
  }
  if (reading.coverage.detectedQuestionCount !== null && reading.coverage.detectedQuestionCount !== readQuestionCount) {
    coverageWarnings.push(`판독 보고상 전체 ${reading.coverage.detectedQuestionCount}문항 중 ${readQuestionCount}문항을 읽었습니다. 나머지 문항을 별도로 확인해주세요.`);
  }
  const draftNote = references.length > 0
    ? '표시된 참고 풀이 기록과 공통 제작 기준을 바탕으로 작성한 검토 전 초안입니다. 수학적 검산과 풀이 방식 확인이 필요합니다.'
    : '문제 조건과 공통 제작 기준을 바탕으로 작성한 검토 전 초안입니다. 직접 적용한 참고 문항이 없어 풀이 방식의 일치 여부를 따로 확인해주세요.';
  const result = ResultSchema.parse({
    ...generated, questions, references,
    productionVersion: HAND_SOLUTION_PRODUCTION_VERSION,
    summary: studentFacingText(generated.summary),
    limitations: [...new Set([
      ...reading.limitations.map(studentFacingText), ...generated.limitations.map(studentFacingText), ...coverageWarnings,
      ...(knowledge.warning ? [knowledge.warning] : []),
      draftNote,
    ])],
    provenance: {
      snapshotId: knowledge.summary.snapshotId, capturedAt: knowledge.summary.capturedAt,
      sampleIds: references.map((reference) => reference.id), exampleJobIds: [], mode,
      evidenceStatus: 'observed_not_teacher_approved',
    },
  });
  validateSolutionStructure(result);
  return result;
}
