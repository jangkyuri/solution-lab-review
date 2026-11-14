import { AppError } from './errors.ts';
import type { SolutionResult } from '../shared/contracts.ts';

type OrderedStep = {
  readonly id: string;
  readonly after: readonly string[];
  readonly branch: string | null;
};
type ReadStep = OrderedStep & { readonly text: string };
type WrittenStep = OrderedStep & { readonly originalStep: string };

export function validateStepGraph(steps: readonly OrderedStep[]): void {
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length || steps.some((step) => !step.id.trim())) {
    throw new AppError(503, '풀이 단계의 식별자가 중복되거나 비어 있습니다. 다시 작성해주세요.');
  }
  for (const step of steps) {
    if (new Set(step.after).size !== step.after.length || step.after.some((id) => !ids.has(id))) {
      throw new AppError(503, '풀이 단계가 존재하지 않는 앞 단계를 가리킵니다. 다시 작성해주세요.');
    }
  }
  const pending = new Set(ids);
  while (pending.size) {
    const ready = steps.filter((step) => pending.has(step.id) && step.after.every((id) => !pending.has(id)));
    if (!ready.length) throw new AppError(503, '풀이 단계의 연결이 순환합니다. 원래 흐름을 다시 확인해주세요.');
    for (const step of ready) pending.delete(step.id);
  }
}

export function validateSolutionStructure(result: SolutionResult): void {
  const numbers = result.questions.map((question) => question.number);
  if (numbers.length === 0 || new Set(numbers).size !== numbers.length || numbers.some((number) => !number.trim())) {
    throw new AppError(400, '결과에는 고유한 번호가 있는 문항이 한 개 이상 필요합니다.');
  }
  for (const question of result.questions) {
    if (!question.problemText.trim()) throw new AppError(400, '문제 내용이 비어 있는 문항은 저장할 수 없습니다.');
    try { validateStepGraph(question.steps); }
    catch (error) {
      if (error instanceof AppError) throw new AppError(400, error.message);
      throw error;
    }
  }
  const references = result.references.map((reference) => reference.id);
  if (new Set(references).size !== references.length || references.some((id) => !/^P\d+$/u.test(id))) {
    throw new AppError(400, '참고 문항은 실제로 사용한 기준 표본만 지정할 수 있습니다.');
  }
  if (result.provenance && references.some((id) => !result.provenance?.sampleIds.includes(id))) {
    throw new AppError(400, '참고 문항과 보관된 생성 근거가 일치하지 않습니다.');
  }
}

export function preserveReadSequence<T extends WrittenStep>(reading: readonly ReadStep[], generated: readonly T[]): T[] {
  validateStepGraph(reading);
  validateStepGraph(generated);
  if (reading.length !== generated.length) throw new AppError(503, '판독한 원문 단계와 보충 단계 수가 달라 검토가 필요합니다.');
  const byId = new Map(generated.map((step) => [step.id, step]));
  return reading.map((source) => {
    const step = byId.get(source.id);
    if (!step || step.branch !== source.branch || step.after.length !== source.after.length || step.after.some((id) => !source.after.includes(id))) {
      throw new AppError(503, '보충 과정에서 원문의 분기나 단계 연결이 달라져 결과를 보류했습니다.');
    }
    return { ...step, originalStep: source.text, after: [...source.after], branch: source.branch };
  });
}
