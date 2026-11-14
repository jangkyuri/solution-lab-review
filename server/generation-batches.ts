import { AppError } from './errors.ts';
import type { GeneratedResult, Reading } from './generation-schemas.ts';

const writingBatchSize = 3;

export function generationBatches(reading: Reading): Reading[] {
  const batches: Reading[] = [];
  for (let start = 0; start < reading.questions.length; start += writingBatchSize) {
    batches.push({ ...reading, questions: reading.questions.slice(start, start + writingBatchSize) });
  }
  return batches;
}

export function orderScopedDraft(reading: Reading, generated: GeneratedResult): GeneratedResult {
  const byNumber = new Map(generated.questions.map((question) => [question.number, question]));
  if (byNumber.size !== generated.questions.length || generated.questions.length !== reading.questions.length) {
    throw new AppError(503, '판독한 문항과 작성한 문항의 대응이 맞지 않습니다. 결과를 다시 확인해주세요.');
  }
  return { ...generated, questions: reading.questions.map((source) => {
    const question = byNumber.get(source.number);
    if (!question) throw new AppError(503, '판독에 없던 문항이 포함되거나 작성할 문항이 빠졌습니다.');
    return question;
  }) };
}

export function mergeGenerationBatches(reading: Reading, batches: readonly GeneratedResult[]): GeneratedResult {
  const first = batches[0];
  if (!first) throw new AppError(503, '작성한 풀이 결과가 없습니다.');
  const references = new Map<string, { readonly reference: GeneratedResult['references'][number]; readonly reasons: Set<string> }>();
  for (const reference of batches.flatMap((batch) => batch.references)) {
    const entry = references.get(reference.id) ?? { reference, reasons: new Set<string>() };
    if (reference.reason.trim()) entry.reasons.add(reference.reason.trim());
    references.set(reference.id, entry);
  }
  return orderScopedDraft(reading, {
    ...first,
    summary: batches.length === 1 ? first.summary : `${reading.questions.length}문항의 풀이 초안입니다.`,
    questions: batches.flatMap((batch) => batch.questions), references: [...references.values()].map(({ reference, reasons }) => ({ ...reference, reason: [...reasons].join('\n') })),
    limitations: [...new Set(batches.flatMap((batch) => batch.limitations))],
  });
}
