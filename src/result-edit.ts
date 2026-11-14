import type { Question, SolutionResult, StepBooklet } from '../shared/contracts';

type Step = Question['steps'][number];
type EditableBookletField = 'group' | 'referenceTip' | 'figure' | 'equationNote' | 'takeaway';
type EditableStepField = 'title' | 'explanation' | 'latex' | 'originalStep';
type EditableQuestionField = 'problemText' | 'firstDecision' | 'answer';

function updateStep(result: SolutionResult, questionIndex: number, stepIndex: number, update: (step: Step) => Step): SolutionResult {
  return { ...result, questions: result.questions.map((question, index) => index === questionIndex
    ? { ...question, steps: question.steps.map((step, current) => current === stepIndex ? update(step) : step) }
    : question) };
}

export function editStep(result: SolutionResult, questionIndex: number, stepIndex: number, field: EditableStepField, value: string): SolutionResult {
  return updateStep(result, questionIndex, stepIndex, step => ({ ...step, [field]: value }));
}

export function editBookletStep<Field extends EditableBookletField>(
  result: SolutionResult, questionIndex: number, stepIndex: number, field: Field, value: StepBooklet[Field],
): SolutionResult {
  return updateStep(result, questionIndex, stepIndex, step => {
    const booklet = { ...step.booklet, [field]: value };
    return { ...step, booklet: Object.values(booklet).some(item => item !== undefined) ? booklet : undefined };
  });
}

export function editQuestion(result: SolutionResult, questionIndex: number, field: EditableQuestionField, value: string): SolutionResult {
  return { ...result, questions: result.questions.map((question: Question, index) => index === questionIndex ? { ...question, [field]: value } : question) };
}
