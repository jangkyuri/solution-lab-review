import type { Question } from '../shared/contracts.ts';
import { formatBookletInlineTex, safeMath } from './pdf-safety.ts';
import { bookletTable, displayBookletMath, isLeadingSourceDefinition } from './pdf-booklet-extras.ts';
import { formatBookletProse } from './pdf-booklet-emphasis.ts';
import { bookletFigure } from './pdf-booklet-graphs.ts';
import { handSolutionStage, studentAnswer } from './pdf-hand-solution.ts';

type Step = Question['steps'][number];
type PrintedStep = { readonly step: Step; readonly graphPath: string | undefined; readonly zoomPath: string | undefined; readonly emphasizeEquation?: boolean; readonly compactReference?: boolean; readonly stageNumber?: number; readonly paired?: boolean; readonly finalMarker?: string;
  readonly splitColumn?: { readonly figureHeight: number; readonly sideFigure: boolean } };

function graphExplanationRepeatsBody(body: string, caption: string): boolean {
  const prose = body.replace(/\s+/gu, ' ').trim();
  const candidate = caption.replace(/\s+/gu, ' ').trim();
  if (!candidate) return true;
  for (let start = prose.indexOf(candidate); start >= 0; start = prose.indexOf(candidate, start + 1)) {
    const prefix = prose.slice(0, start);
    const suffix = prose.slice(start + candidate.length);
    const beginsSentence = !prefix || /[.!?。！？] $/u.test(prefix);
    const endsSentence = !suffix || (/[.!?。！？]$/u.test(candidate) && suffix.startsWith(' '));
    if (beginsSentence && endsSentence) return true;
  }
  return false;
}

function stepEquation(step: Step, definitionFirst: boolean, emphasizeEquation: boolean, compactReference: boolean, layout: 'standard' | 'paired' | 'left', prefix: string): string[] {
  if (!step.latex.trim()) return [];
  const math = safeMath(step.latex);
  const note = step.booklet?.equationNote;
  if (layout === 'standard' && !compactReference && math && !definitionFirst && step.booklet?.equationRole !== 'key' && note && !step.booklet?.termNotes?.length) {
    return [String.raw`\baeksinequation{\(\displaystyle ${math}\)}{${formatBookletInlineTex(note)}}`];
  }
  return [displayBookletMath(step.latex, step.booklet?.termNotes, emphasizeEquation ? step.booklet?.equationRole : undefined, layout, prefix),
    note ? String.raw`\baeksinlabel{${formatBookletInlineTex(note)}}` : '',
  ].filter(Boolean);
}

function stepClosure(step: Step, graphPath: string | undefined): string[] {
  return [
    step.booklet?.takeaway ? String.raw`{\color{accent}${formatBookletProse(step.booklet.takeaway, step.booklet.keyPhrases)}}` : '',
    graphPath && !step.booklet?.equationNote && !step.booklet?.takeaway
      && step.graph?.explanation.trim() && !graphExplanationRepeatsBody(step.explanation, step.graph.explanation)
      ? formatBookletProse(step.graph.explanation) : '',
  ].filter(Boolean);
}

function graphic(file: string, width: string, height = '.35\\textheight'): string {
  return file.endsWith('.tex') ? String.raw`\input{${file}}`
    : String.raw`\includegraphics[width=${width},height=${height},keepaspectratio]{${file}}`;
}

export function renderBookletStep({ step, graphPath, zoomPath, emphasizeEquation = true, compactReference = false, stageNumber, paired = false, finalMarker, splitColumn }: PrintedStep, answer: string, problem: string): string {
  const table = step.booklet?.table ? bookletTable(step.booklet.table, paired || Boolean(splitColumn)) : '';
  const linked = Boolean(graphPath && step.booklet?.graphLinks?.length);
  const figure = zoomPath ? step.booklet?.figure ?? 'side' : bookletFigure(step.booklet, compactReference);
  const hasEvidence = Boolean(table || graphPath);
  const definitionFirst = isLeadingSourceDefinition(step.latex, problem);
  const math = safeMath(step.latex);
  const keyJudgment = Boolean(table && step.booklet?.equationRole === 'key');
  const graphFirst = stageNumber !== undefined && Boolean(graphPath);
  const heading = stageNumber === undefined ? '' : String.raw`\par${splitColumn ? '' : '\\Needspace{48bp}'}{\labeltext\bfseries\color{accent}${handSolutionStage(stageNumber, step.title)}}\par\nobreak` + '\n';
  const finalReference = finalMarker !== undefined;
  const equationFirst = finalReference ? Boolean(table && !graphPath && !keyJudgment && math !== null)
    : definitionFirst || (!graphFirst && math !== null && (hasEvidence ? !keyJudgment
      : step.booklet?.equationRole === 'key' || Boolean(step.booklet?.equationNote && !step.booklet.termNotes?.length)));
  const marker = finalMarker ? String.raw`\baeksinfinalmark{${finalMarker}}` : '';
  const markerOnEquation = Boolean(marker && step.latex.trim() && (equationFirst || (!table && !step.explanation.trim())));
  const evidenceMarker = marker && table && !markerOnEquation ? String.raw`${marker}\par\nobreak` + '\n' : '';
  const equation = stepEquation(step, definitionFirst, emphasizeEquation && !compactReference, compactReference, paired ? 'paired' : finalReference || splitColumn ? 'left' : 'standard', markerOnEquation ? marker : '');
  const reason = (markerOnEquation || evidenceMarker ? '' : marker) + (step.explanation.trim() ? formatBookletProse(step.explanation, step.booklet?.keyPhrases) : '');
  const tipText = step.booklet?.referenceTip?.trim();
  const repeatedTip = graphPath && step.booklet?.graphLinks?.some((link) => link.note.replace(/\s+/gu, ' ').trim() === tipText?.replace(/\s+/gu, ' '));
  const tip = tipText && !repeatedTip ? String.raw`\baeksinreference{${formatBookletInlineTex(tipText)}}` : '';
  if (splitColumn) {
    const visual = graphPath ? String.raw`\baeksinsplitgraphic{${splitColumn.figureHeight}bp}{${graphic(graphPath, '\\linewidth')}}` : '';
    const sideFigure = visual && reason && splitColumn.sideFigure && !zoomPath && !table;
    const evidence = sideFigure
      ? String.raw`\baeksinsplitside{${reason}}{${visual}}`
      : visual;
    const zoom = zoomPath ? String.raw`\baeksinsplitgraphic{90bp}{${graphic(zoomPath, '\\linewidth')}}` : '';
    const zoomNote = zoom ? String.raw`\baeksinlabel{${formatBookletInlineTex(step.booklet?.zoomNote?.trim() || '부분 확대')}}` : '';
    return heading + [...(equationFirst ? equation : []), evidence, zoom, zoomNote, table, sideFigure ? '' : reason,
      ...(!equationFirst ? equation : []), ...stepClosure(step, graphPath), tip]
      .filter(Boolean).join('\n\\par\\vspace{3bp}\n');
  }
  if (compactReference && graphPath && !zoomPath && figure !== 'wide') {
    const left = [...(equationFirst ? equation : []), evidenceMarker + table, reason, ...(!equationFirst ? equation : []),
      ...stepClosure(step, graphPath)].filter(Boolean).join('\n\\par\\vspace{\\baeksinreferencegap}\n');
    const visual = [graphic(graphPath, figure === 'small' ? '150bp' : '190bp'), tip].filter(Boolean).join('\n\\par\n');
    return String.raw`\baeksinevidence{${heading}\begin{baeksinside}{${left}}{${visual}}\end{baeksinside}${studentAnswer(answer)}}`;
  }
  const parts: string[] = equationFirst ? [...equation] : [];
  let besideReason = false;
  if (graphPath) {
    if (evidenceMarker) parts.push(evidenceMarker);
    if (paired) {
      parts.push(String.raw`\solutionpairsource{${graphic(graphPath, '\\linewidth')}}`);
      if (zoomPath) parts.push(String.raw`\solutionpairsource{${graphic(zoomPath, '\\linewidth')}}`, String.raw`\baeksinlabel{${formatBookletInlineTex(step.booklet?.zoomNote?.trim() || '부분 확대')}}`);
      parts.push(tip, table);
    } else if (zoomPath) {
      const caption = step.booklet?.zoomNote?.trim() || '부분 확대';
      parts.push(String.raw`\baeksinzoom{${graphic(graphPath, '\\linewidth')}}{${graphic(zoomPath, '\\linewidth')}}{${formatBookletInlineTex(caption)}}`, tip, table);
    } else if (figure === 'wide') {
      parts.push(String.raw`\begin{center}${graphic(graphPath, '.96\\linewidth', '.37\\textheight')}\end{center}`, tip, table);
    } else {
      const visual = [graphic(graphPath, figure === 'small' ? '150bp' : '190bp'), tip].filter(Boolean).join('\n\\par\n');
      if (table || reason) {
        parts.push(String.raw`\begin{baeksinside}{${table || reason}}{${visual}}\end{baeksinside}`);
        besideReason = !table;
      } else parts.push(String.raw`\begin{center}${visual}\end{center}`);
    }
  } else if (table) parts.push(evidenceMarker + table);
  if (!besideReason) parts.push(reason);
  if (!equationFirst) parts.push(...equation);
  parts.push(...stepClosure(step, graphPath));
  if (!graphPath) parts.push(tip);
  if (answer.trim()) parts.push(studentAnswer(answer));
  const visible = parts.filter(Boolean);
  const separator = paired ? '\n\\par\\vspace{6bp}\n' : compactReference ? '\n\\par\\vspace{\\baeksinreferencegap}\n' : '\n\\par\\vspace{12bp}\n';
  if (compactReference && answer.trim()) {
    const conclusion = visible.slice(-2).join(separator);
    const content = heading + [...visible.slice(0, -2), String.raw`\baeksinevidence{${conclusion}}`].join(separator);
    return String.raw`\baeksincompactstep{${content}}`;
  }
  const content = heading + visible.join(separator);
  if (paired) return content;
  if (compactReference) return String.raw`\baeksincompactstep{${content}}`;
  return !compactReference && (table || linked || answer.trim()) ? String.raw`\baeksinevidence{${content}}` : content;
}
