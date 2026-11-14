import type { Question } from '../shared/contracts.ts';
import { handSolutionStepTitle, inlineHandSolutionAnswer, studentQuestionNumber } from '../shared/hand-solution-output.ts';
import { escapeTex, formatBookletInlineTex, formatInlineTex } from './pdf-safety.ts';

export function handSolutionLead(question: Question, includeNumber = true): string[] {
  const number = includeNumber ? studentQuestionNumber(question.number) : '';
  const core = question.firstDecision.trim();
  return [String.raw`\par\Needspace{55pt}`,
    number ? String.raw`{\labeltext\bfseries 문제 ${escapeTex(number)}}\par\nobreak` : '',
    core ? String.raw`\textbf{핵심:} ${formatBookletInlineTex(core)}\par` : '',
  ].filter(Boolean);
}

export function studentAnswer(answer: string, readableFractions = true): string {
  const fraction = answer.trim().replace(/^([+-]?)(\d+)\/(\d+)$/u, '$1\\frac{$2}{$3}');
  const format = readableFractions ? formatBookletInlineTex : formatInlineTex;
  const formatted = format(inlineHandSolutionAnswer(fraction));
  return formatted ? String.raw`\par\nobreak\kern 3bp{\color{rulegray}\hrule height .4bp}\nobreak\kern 4bp{\raggedleft\color{black}\noindent\textbf{정답}\enspace ${formatted}\par}` : '';
}

export function handSolutionStage(stage: number, title: string): string {
  const formatted = formatBookletInlineTex(handSolutionStepTitle(title));
  return `${stage}단계.${formatted ? ` ${formatted}` : ''}`;
}

