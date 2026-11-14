import type { Reading } from './generation-schemas.ts';

function normalizePrefix(text: string): string {
  return text.normalize('NFKC').replace(/\\[()]/gu, '').replace(/\s+/gu, ' ').trim();
}

function corroboratedNumber(question: Reading['questions'][number]): boolean {
  if (question.printedNumberPrefix === null) return false;
  const label = normalizePrefix(question.number);
  if (!label || /^(?:미확인|unknown|unnumbered)/iu.test(label)) return false;
  const prefix = normalizePrefix(question.printedNumberPrefix);
  const withoutOpeningBracket = prefix.replace(/^[\[({【]+/u, '');
  if (!withoutOpeningBracket.startsWith(label)) return false;
  const followingStem = withoutOpeningBracket.slice(label.length);
  if (!/^[\s.)\]】}:：-]/u.test(followingStem) || !/[A-Za-z\p{Script=Hangul}]/u.test(followingStem)) return false;
  const compact = (text: string): string => normalizePrefix(text).replace(/\s/gu, '');
  return compact(question.problemText).startsWith(compact(prefix));
}

function stripConfirmedLabel(question: Reading['questions'][number]): string {
  const body = question.problemText.replace(/^\s*[\[({【（［｛]*/u, '');
  const label = normalizePrefix(question.number);
  let consumed = 0;
  for (const character of body) {
    consumed += character.length;
    if (normalizePrefix(body.slice(0, consumed)) === label) {
      return body.slice(consumed).replace(/^[)\]】}）］｝]*[.:：]?\s*/u, '');
    }
  }
  return question.problemText;
}

export function normalizeReadingNumbers(reading: Reading): Reading {
  let unnamed = 0;
  return { ...reading, questions: reading.questions.map((question) => {
    if (corroboratedNumber(question)) return { ...question, problemText: stripConfirmedLabel(question) };
    unnamed += 1;
    return { ...question, number: `미확인-${unnamed}` };
  }) };
}
