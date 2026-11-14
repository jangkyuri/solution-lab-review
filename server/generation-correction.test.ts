import { describe, expect, it } from 'vitest';
import { generatedFixture, readingFixture } from './generation-fixtures.ts';
import { mergeScopedCorrection } from './generation-correction.ts';

function fixture() {
  const reading = structuredClone(readingFixture);
  const previous = generatedFixture();
  const source = reading.questions[0];
  const question = previous.questions[0];
  const first = question?.steps[0];
  if (!source || !question || !first) throw new Error('Missing fixture step.');
  source.observedSteps.push({ id: 'S02', text: '다음 원문 식', after: ['S01'], branch: null });
  question.steps.push({ ...first, id: 'S02', after: ['S01'], originalStep: 'previous transcription' });
  const regenerated = structuredClone(previous);
  const fresh = regenerated.questions[0];
  if (!fresh || !fresh.steps[0] || !fresh.steps[1]) throw new Error('Missing regenerated fixture step.');
  fresh.answer = 'unrelated answer corruption';
  fresh.steps[0].explanation = 'unrelated explanation corruption';
  fresh.steps[1].latex = 'f^{\\prime}(x)=2x';
  fresh.steps[1].explanation = '수정한 대상의 설명';
  fresh.steps[1].originalStep = 'rewritten transcription';
  return { reading, previous, regenerated };
}

describe('source-scoped automatic correction merge', () => {
  it('accepts only the identified correction and preserves every other field', () => {
    const data = fixture();
    const merged = mergeScopedCorrection(data.reading, { ...data, issues: ['1번 S02의 계산을 고쳐야 한다.'] });
    expect(merged.questions[0]?.answer).toBe(data.previous.questions[0]?.answer);
    expect(merged.questions[0]?.steps[0]).toBe(data.previous.questions[0]?.steps[0]);
    expect(merged.questions[0]?.steps[1]?.explanation).toBe(data.regenerated.questions[0]?.steps[1]?.explanation);
    for (const field of ['id', 'after', 'branch', 'originalStep'] as const) {
      expect(merged.questions[0]?.steps[1]?.[field]).toEqual(data.previous.questions[0]?.steps[1]?.[field]);
    }
  });

  it.each([
    '1번의 그래프 근거가 부족하다.', '1번 S99의 계산이 잘못되었다.',
    '1번 S02 오류 때문에 문항 정답도 틀렸다.',
    '1번 S02의 정의가 firstDecision에 반복된다.',
    '1번 S02를 고치면 첫 판단도 바꿔야 한다.',
    '1번 S02의 내용을 다른 단계에서도 고쳐야 한다.',
    '1번 S02 오류가 전체 풀이에 영향을 준다.',
    '1번 S02 오류 때문에 question.answer를 고쳐야 한다.',
  ])('falls back to the full draft for a global or unknown issue (%s)', (issue) => {
    const data = fixture();
    expect(mergeScopedCorrection(data.reading, { ...data, issues: [issue] })).toBe(data.regenerated);
  });

  it('falls back when the regenerated step dependencies no longer match the source', () => {
    const data = fixture();
    const step = data.regenerated.questions[0]?.steps[1];
    if (!step) throw new Error('Missing target step.');
    step.after = [];
    expect(mergeScopedCorrection(data.reading, { ...data, issues: ['1번 S02의 계산을 고쳐야 한다.'] })).toBe(data.regenerated);
  });

  it('falls back when repeated step IDs cannot be tied to one question', () => {
    const data = fixture();
    const source = data.reading.questions[0];
    const previous = data.previous.questions[0];
    const regenerated = data.regenerated.questions[0];
    if (!source || !previous || !regenerated) throw new Error('Missing question fixture.');
    data.reading.questions.push({ ...structuredClone(source), number: '2' });
    data.previous.questions.push({ ...structuredClone(previous), number: '2' });
    data.regenerated.questions.push({ ...structuredClone(regenerated), number: '2' });
    expect(mergeScopedCorrection(data.reading, { ...data, issues: ['S02의 계산을 고쳐야 한다.'] })).toBe(data.regenerated);
    const merged = mergeScopedCorrection(data.reading, { ...data, issues: ['2번 S02의 계산을 고쳐야 한다.'] });
    expect(merged.questions[0]).toBe(data.previous.questions[0]);
    expect(merged.questions[1]?.steps[1]?.explanation).toBe(data.regenerated.questions[1]?.steps[1]?.explanation);
  });
});
