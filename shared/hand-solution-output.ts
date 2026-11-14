import type { Question } from './contracts.ts';

export const HAND_SOLUTION_PRODUCTION_VERSION = 'hand-solution-v1';

const confirmationMarker = '[확인 필요]';
const leadingConfirmationMarkers = /^(?:\[확인\s+필요\]\s*)+/u;
const missingQuestionNumbers = new Set(['', '미확인', '미상', '없음', 'unknown', 'unnumbered']);

export function withConfirmationMarker(text: string): string {
  const content = text.trim().replace(leadingConfirmationMarkers, '');
  return content ? `${confirmationMarker} ${content}` : '';
}

export function studentQuestionNumber(number: string): string {
  const marker = number.trim();
  return missingQuestionNumbers.has(marker.toLowerCase()) || /^미확인-[1-9]\d*$/u.test(marker) ? '' : marker;
}

export function handSolutionStepTitle(title: string): string {
  return title.trim().replace(/^\d+(?:\s*단계[.:]?\s*|[.)](?:\s+|$))/u, '');
}

export function inlineHandSolutionAnswer(answer: string): string {
  const text = answer.trim().replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/gu,
    (_match, bracketed: string | undefined, dollars: string | undefined) => `\\(${bracketed ?? dollars ?? ''}\\)`);
  const prose = /[\p{Script=Hangul}\p{Script=Han}]/u.test(text.replace(/\\text\{[^{}]*\}/gu, ''));
  const delimited = text.includes('\\(') || text.includes('\\[') || text.includes('$');
  const hasMathNotation = /\\[A-Za-z]|[=^_]|^[+-]?\d+\/\d+$|^\d*[a-z]$/u.test(text);
  return !prose && !delimited && hasMathNotation ? `\\(${text}\\)` : text;
}

export function handSolutionNotices(question: Question): string[] {
  const notices = new Map<string, string>();
  for (const note of [...question.steps.map(step => step.sourceConflict ?? ''), ...question.uncertainties]) {
    let content = note.trim().replace(leadingConfirmationMarkers, '');
    for (const step of question.steps) {
      const legacyPrefix = `${step.id} 단계 원문 판독 확인이 필요합니다. `;
      if (step.id && content.startsWith(legacyPrefix)) {
        content = content.slice(legacyPrefix.length);
        break;
      }
    }
    const notice = withConfirmationMarker(content);
    const key = notice.replace(/\s+/gu, ' ');
    if (notice && !notices.has(key)) notices.set(key, notice);
  }
  return [...notices.values()];
}
