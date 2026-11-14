import { describe, expect, it } from 'vitest';
import { readingFixture } from './generation-fixtures.ts';
import { normalizeReadingNumbers } from './reading-number.ts';

describe('source-backed printed question numbering', () => {
  it('does not use a boxed answer as the question number without a printed stem prefix', () => {
    const question = readingFixture.questions[0];
    if (!question) throw new Error('Missing fixture question.');
    const reading = { ...readingFixture, questions: [{ ...question, number: '5', printedNumberPrefix: null, problemText: '함수 f(x)의 최댓값은?' }] };
    expect(normalizeReadingNumbers(reading).questions[0]?.number).toBe('미확인-1');
    expect(reading.questions[0]?.number).toBe('5');
  });

  it('keeps two unnumbered questions distinct without changing their steps', () => {
    const question = readingFixture.questions[0];
    if (!question) throw new Error('Missing fixture question.');
    const reading = { ...readingFixture, questions: [
      { ...question, number: '5', printedNumberPrefix: null },
      { ...question, number: '5', printedNumberPrefix: null },
    ] };
    const normalized = normalizeReadingNumbers(reading);
    expect(normalized.questions.map((item) => item.number)).toEqual(['미확인-1', '미확인-2']);
    expect(normalized.questions.map((item) => item.observedSteps)).toEqual(reading.questions.map((item) => item.observedSteps));
  });

  it('retains a numeric or letter label only when the numbered stem prefix is corroborated', () => {
    const question = readingFixture.questions[0];
    if (!question) throw new Error('Missing fixture question.');
    const reading = { ...readingFixture, questions: [
      question,
      { ...question, number: 'A', printedNumberPrefix: 'A. 함수 f(x)', problemText: 'A. 함수 \\(f(x)\\)의 도함수를 구하여라.' },
      { ...question, number: '5', printedNumberPrefix: '5. 함수', problemText: '함수 f(x)의 최댓값은?' },
    ] };
    const normalized = normalizeReadingNumbers(reading);
    expect(normalized.questions.map((item) => item.number)).toEqual(['1', 'A', '미확인-1']);
    expect(normalized.questions[0]?.problemText).toBe('함수 f(x)=x^2의 도함수를 구하여라.');
    expect(normalized.questions[1]?.problemText).toBe('함수 \\(f(x)\\)의 도함수를 구하여라.');
    expect(normalized.questions[0]?.printedNumberPrefix).toBe('1. 함수');
    expect(reading.questions[0]?.problemText).toBe('1. 함수 f(x)=x^2의 도함수를 구하여라.');
  });

  it('preserves the complete mathematical stem after removing only the confirmed opening label', () => {
    const question = readingFixture.questions[0];
    if (!question) throw new Error('Missing fixture question.');
    const reading = { ...readingFixture, questions: [{ ...question, number: '2', printedNumberPrefix: '2. \\(-x\\)', problemText: '2. \\(-x\\)의 값은?' }] };
    expect(normalizeReadingNumbers(reading).questions[0]?.problemText).toBe('\\(-x\\)의 값은?');
  });
});
