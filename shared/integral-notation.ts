import type { SolutionResult } from './contracts.ts';

const evaluationBars = new Set(['|', '\\vert', '\\rvert']);
const mathBoundaries = new Set(['$', '\\(', '\\)', '\\[', '\\]']);

function scriptEnd(tokens: readonly RegExpMatchArray[], start: number): number | undefined {
  const argument = tokens[start]?.[0];
  if (!argument || mathBoundaries.has(argument) || ['_', '^', '}', '&'].includes(argument)) return undefined;
  if (argument !== '{') return start + 1;

  let depth = 1;
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index]?.[0];
    if (token === '{') depth += 1;
    if (token === '}') depth -= 1;
    if (depth === 0) return index > start + 1 ? index + 1 : undefined;
  }
  return undefined;
}

export function normalizeIntegralEvaluation(value: string): string {
  if (!value.includes('\\left') || !value.includes('\\right')) return value;

  const tokens = Array.from(value.matchAll(/\\(?:[A-Za-z]+|[\s\S])|[^\s]/gu));
  const openings: number[] = [];
  const replacements = new Map<number, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const command = tokens[index]?.[0] ?? '';
    if (mathBoundaries.has(command)) openings.length = 0;
    if (command === '\\left') openings.push(++index);
    if (command !== '\\right') continue;

    const opening = openings.pop();
    const closing = ++index;
    if (opening === undefined || tokens[opening]?.[0] !== '.' || !evaluationBars.has(tokens[closing]?.[0] ?? '')) continue;

    const first = tokens[closing + 1]?.[0];
    if (first !== '_' && first !== '^') continue;
    const second = scriptEnd(tokens, closing + 2);
    if (second === undefined || tokens[second]?.[0] !== (first === '_' ? '^' : '_') || scriptEnd(tokens, second + 1) === undefined) continue;
    replacements.set(opening, '[');
    replacements.set(closing, ']');
  }

  const parts: string[] = [];
  let end = 0;
  for (const [index, replacement] of [...replacements].sort(([a], [b]) => a - b)) {
    const token = tokens[index];
    if (token?.index === undefined) continue;
    parts.push(value.slice(end, token.index), replacement);
    end = token.index + token[0].length;
  }
  return parts.length ? parts.join('') + value.slice(end) : value;
}

export function formatSolutionIntegralNotation(result: SolutionResult): SolutionResult {
  return { ...result, questions: result.questions.map(question => ({
    ...question,
    firstDecision: normalizeIntegralEvaluation(question.firstDecision),
    answer: normalizeIntegralEvaluation(question.answer),
    steps: question.steps.map(step => ({
      ...step,
      explanation: normalizeIntegralEvaluation(step.explanation),
      latex: normalizeIntegralEvaluation(step.latex),
      booklet: step.booklet && {
        ...step.booklet,
        equationNote: step.booklet.equationNote && normalizeIntegralEvaluation(step.booklet.equationNote),
        takeaway: step.booklet.takeaway && normalizeIntegralEvaluation(step.booklet.takeaway),
        referenceTip: step.booklet.referenceTip && normalizeIntegralEvaluation(step.booklet.referenceTip),
        termNotes: step.booklet.termNotes?.map(note => ({ ...note, term: normalizeIntegralEvaluation(note.term) })),
        table: step.booklet.table?.map(row => row.map(normalizeIntegralEvaluation)),
      },
    })),
  })) };
}
