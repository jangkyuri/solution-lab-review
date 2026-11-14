
import type { Job, Question } from '../shared/contracts.ts';
import { HAND_SOLUTION_PRODUCTION_VERSION, studentQuestionNumber } from '../shared/hand-solution-output.ts';
import type { PdfPurpose } from './pdf-paired-hand-solution.ts';
import type { PdfAsset } from './pdf-template.ts';
import { escapeTex, formatBookletInlineTex, mathBlock } from './pdf-safety.ts';
import { BAEKSIN_EXTRAS_PREAMBLE } from './pdf-booklet-extras.ts';
import { renderBookletStep } from './pdf-booklet-layout.ts';
import { isCompactKeyMath } from './pdf-booklet-math.ts';
import { isSingleQuestionSource, originalProblemTex } from './pdf-originals.ts';
import { STACKED_REFERENCE_PREAMBLE, mappedSourcePanelsTex, stackedSourceTex } from './pdf-stacked-reference.ts';
import { SPLIT_SUPPLEMENT_PREAMBLE, splitSupplementTex } from './pdf-split-supplement.ts';
import { handSolutionLead, studentAnswer } from './pdf-hand-solution.ts';

type Step = Question['steps'][number];
type PrintedStep = { readonly step: Step; readonly graphPath: string | undefined; readonly zoomPath: string | undefined; readonly emphasizeEquation: boolean };
type Group = { readonly marker: string; readonly steps: PrintedStep[] };

function studentQuestionMarker(number: string): string {
  return escapeTex(studentQuestionNumber(number));
}

function sourceHeight(question: Question | undefined, finalReference: boolean): number {
  return finalReference && (question?.steps.filter(step => step.figureRecipe || step.graph).length ?? 0) >= 4 ? 252 : 265;
}

export function baeksinBookletPreamble(title: string, side: number, top: number, bottom: number, mode: Job['mode'] = 'supplement', stacked = false): string {
  return String.raw`
\newcommand{\baeksinlabel}[1]{{\labeltext\color{muted}\fontsize{8bp}{10bp}\selectfont #1}}
\newcommand{\baeksinfolio}{\setlength{\footskip}{14bp}\fancyfoot[R]{\baeksinlabel{\thepage}}}
\newcommand{\baeksinrunning}[1]{%
  \fancyhf{}\renewcommand{\headrulewidth}{0pt}%
  \fancyhead[L]{\baeksinlabel{${escapeTex(title.slice(0, 48))}}}%
  \fancyhead[R]{\baeksinlabel{#1}}\baeksinfolio\pagestyle{fancy}%
}
\newcommand{\baeksinsourcepage}[1]{\clearpage\restoregeometry\baeksinrunning{#1}}
\newcommand{\baeksinrecapcontent}[4]{%
  \clearpage
  \sbox{\problemrecap}{\begin{minipage}{\dimexpr\paperwidth-${side * 2}bp\relax}
    \baeksinlabel{${escapeTex(title.slice(0, 48))}}\hfill\baeksinlabel{\if\relax\detokenize{#1}\relax\else#1번 · \fi{}${mode === 'solve' ? '풀이' : '풀이 보충'}}\par\vspace{7bp}
    #3#2\par\vspace{10bp}
    {\color{rulegray}\hrule height .4bp}
  \end{minipage}}%
  \setlength{\recapheight}{\dimexpr\ht\problemrecap+\dp\problemrecap\relax}
  \ifdim\recapheight>#4\PackageError{solutionlab}{Problem recap too long}{Split this question before exporting.}\fi
  \newgeometry{left=${side}bp,right=${side}bp,top=\dimexpr ${Math.max(8, top - 17)}bp+\recapheight+25bp\relax,bottom=${bottom}bp,headheight=\recapheight,headsep=25bp}
  \fancyhf{}\renewcommand{\headrulewidth}{0pt}\fancyhead[C]{\usebox{\problemrecap}}\baeksinfolio\pagestyle{fancy}%
}
\newcommand{\baeksinrecap}[2]{\baeksinrecapcontent{#1}{#2}{\if\relax\detokenize{#1}\relax\else\textbf{#1.}\ \fi}{105mm}}
\newcommand{\baeksinimagerecap}[2]{\baeksinrecapcontent{#1}{#2}{}{120mm}}
\let\baeksinpendingmarker\empty
\newlength{\baeksinmarkerwidth}\setlength{\baeksinmarkerwidth}{${stacked ? 12 : 16}bp}
\newlength{\baeksinmarkergap}\setlength{\baeksinmarkergap}{${stacked ? 4 : 8}bp}
\newlength{\baeksingroupgap}\setlength{\baeksingroupgap}{16bp}
\newlength{\baeksinreferencegap}\setlength{\baeksinreferencegap}{12bp}
\newcommand{\baeksinmarkertext}[1]{{\labeltext\bfseries\color{accent}\fontsize{${stacked ? '11.2' : '12'}bp}{16bp}\selectfont #1}}
\newcommand{\baeksinmarkertop}[1]{\begin{minipage}[t]{\baeksinmarkerwidth}\vspace{0pt}\baeksinmarkertext{#1}\par\end{minipage}}
\newcommand{\baeksinstart}{%
  \ifx\baeksinpendingmarker\empty\else
    \leavevmode\llap{\makebox[\baeksinmarkerwidth][l]{\baeksinmarkertext{\baeksinpendingmarker}}\hspace{\baeksinmarkergap}}%
    \let\baeksinpendingmarker\empty
  \fi
}
\newenvironment{baeksingroup}[1]{%
  \par\Needspace{44bp}\begin{list}{}{%
    \setlength{\leftmargin}{\dimexpr\baeksinmarkerwidth+\baeksinmarkergap\relax}\setlength{\rightmargin}{0pt}%
    \setlength{\labelwidth}{\baeksinmarkerwidth}\setlength{\labelsep}{\baeksinmarkergap}%
    \setlength{\topsep}{0pt}\setlength{\partopsep}{0pt}%
    \setlength{\parsep}{5bp}\setlength{\itemsep}{0pt}}%
    \item[]\def\baeksinpendingmarker{#1}%
    \raggedright
}{\end{list}\par\vspace{\baeksingroupgap}}
\newsavebox{\baeksinrow}
\newsavebox{\baeksinformula}
${BAEKSIN_EXTRAS_PREAMBLE}
${stacked ? STACKED_REFERENCE_PREAMBLE : ''}
\newenvironment{baeksinside}[2]{%
  \par\sbox{\baeksinrow}{\hbox to \linewidth{%
    \begin{minipage}[t]{\dimexpr\linewidth-210bp\relax}\vspace{0pt}#1\end{minipage}\hfill
    \begin{minipage}[t]{190bp}\vspace{0pt}\centering #2\end{minipage}}}%
  \ifdim\dimexpr\ht\baeksinrow+\dp\baeksinrow\relax>.64\textheight
    \begin{center}#2\end{center}#1\par%
  \else
    \Needspace{\dimexpr\ht\baeksinrow+\dp\baeksinrow+4bp\relax}\noindent\usebox{\baeksinrow}\par
  \fi
}{}
\newcommand{\baeksinequation}[2]{%
  \par\vspace{12bp}\sbox{\baeksinformula}{#1}%
  \ifdim\wd\baeksinformula>.36\linewidth
    \begin{center}#1\end{center}\baeksinlabel{#2}\par
  \else
    \noindent\begin{minipage}[c]{.36\linewidth}\raggedleft\usebox{\baeksinformula}\end{minipage}\hspace{5bp}%
    {\color{rulegray}\rule{.23\linewidth}{.4bp}}\hspace{8bp}%
    \begin{minipage}[c]{.33\linewidth}\baeksinlabel{#2}\end{minipage}\par
  \fi\vspace{27bp}
}
`;
}

function formatProblem(text: string): string {
  return text.split(/(\\\[[\s\S]*?\\\])/gu).map((part, index) =>
    index % 2 === 0 ? formatBookletInlineTex(part) : mathBlock(part.slice(2, -2))).join('');
}

function groupsFor(question: Question, index: number, graphs: ReadonlyMap<string, string>): Group[] {
  const groups: Group[] = [];
  const keyIndex = question.steps.findIndex(step => step.booklet?.equationRole === 'key' && isCompactKeyMath(step.latex));
  for (const [stepIndex, step] of question.steps.entries()) {
    const graphPath = graphs.get(`${index}-${stepIndex}`);
    if (!step.explanation.trim() && !step.latex.trim() && !step.graph && !step.booklet && !graphPath) continue;
    const group = groups.at(-1);
    const section = step.booklet?.group ?? step.branch;
    const previous = group?.steps.at(-1)?.step;
    const zoomPath = graphs.get(`${index}-${stepIndex}:zoom`);
    const printed = { step, graphPath, zoomPath, emphasizeEquation: stepIndex === keyIndex };
    if (section && group && section === (previous?.booklet?.group ?? previous?.branch)) group.steps.push(printed);
    else groups.push({ marker: step.booklet?.group ?? (groups.length < 26 ? String.fromCharCode(65 + groups.length) : String(groups.length + 1)), steps: [printed] });
  }
  return groups;
}

function studentGroup(group: Group, answer: string, problem: string, compactReference: boolean, firstStage: number | undefined, finalReference: boolean): string[] {
  const steps = group.steps.map((printed, index) => renderBookletStep({ ...printed, compactReference,
    ...(finalReference ? { finalMarker: index === 0 ? escapeTex(group.marker) : '' }
      : firstStage === undefined ? {} : { stageNumber: firstStage + index }),
  }, index === group.steps.length - 1 ? answer : '', problem));
  if (finalReference) return [steps.join('\n\\par\\addvspace{\\baselineskip}\n')];
  const markerOwned = steps[0]?.startsWith(String.raw`\baeksinevidence{`) || steps[0]?.startsWith(String.raw`\baeksincompactstep{`);
  const anchor = markerOwned || firstStage !== undefined ? [] : [String.raw`\baeksinstart`];
  const marker = firstStage === undefined ? escapeTex(group.marker) : '';
  return [String.raw`\begin{baeksingroup}{${marker}}`, ...anchor, ...steps, String.raw`\end{baeksingroup}`];
}

function sourcePages(assets: readonly PdfAsset[], mode: Job['mode'], questionNumber?: string): string[] {
  const number = questionNumber ? studentQuestionMarker(questionNumber) : '';
  const prefix = number ? `${number}번 · ` : '';
  return assets.flatMap((asset) => {
    const solutionKind = mode === 'solve' ? '참고해설' : '손풀이';
    const kind = asset.role === 'exam_and_handwriting' ? `문제·${solutionKind}` : asset.role === 'exam' ? '문제' : solutionKind;
    const heading = `${prefix}${kind}`;
    if (asset.mimeType === 'application/pdf') return [
      String.raw`\clearpage\restoregeometry\includepdf[pages=-,scale=.90,pagecommand={\baeksinrunning{${heading}}}]{${asset.localName}}`,
    ];
    return [
      String.raw`\baeksinsourcepage{${heading}}`,
      String.raw`\null\vfill\noindent\makebox[\linewidth][c]{\includegraphics[width=\linewidth,height=.83\textheight,keepaspectratio]{${asset.localName}}}\par\vfill\null`,
    ];
  });
}

export function renderBaeksinBooklet(job: Job, assets: readonly PdfAsset[], graphs: ReadonlyMap<string, string>, purpose: PdfPurpose): string {
  const questions = job.result?.questions ?? [];
  const handSolution = job.result?.productionVersion === HAND_SOLUTION_PRODUCTION_VERSION;
  const sourceAssets = job.mode === 'solve' ? assets.filter(asset => asset.role !== 'handwriting') : assets;
  const stacked = job.pdfDesign?.sourceLayout === 'stacked-reference';
  const single = isSingleQuestionSource(job);
  const finalReference = purpose === 'export' && handSolution && stacked;
  const sourceMacro = finalReference ? 'baeksinfinalsource' : 'baeksinstackedsource';
  const referenceEnvironment = finalReference ? 'baeksinfinalreference' : 'baeksinhandreference';
  const referenceTitle = job.mode === 'supplement' ? '손풀이 참고' : '풀이';
  const pairedSource = stacked ? stackedSourceTex(job, sourceAssets, finalReference, sourceHeight(questions[0], finalReference)) : null;
  const fullWidthQuestions = handSolution && stacked && (!single || Boolean(job.originalProblems?.length) || (finalReference && !pairedSource));
  const usedAssets = new Set<PdfAsset>();
  const body = pairedSource || fullWidthQuestions ? [] : sourcePages(sourceAssets, job.mode, single ? questions[0]?.number : undefined);
  const useCompactSupplement = finalReference && job.pdfDesign?.fontSize === 11 && job.pdfDesign.stepLayout !== 'separate'
    && sourceAssets.some(asset => asset.sourcePanels || asset.mappedSourceSplits?.size);
  if (useCompactSupplement) body.unshift(SPLIT_SUPPLEMENT_PREAMBLE);
  for (const [questionIndex, question] of questions.entries()) {
    const number = studentQuestionMarker(question.number);
    const groups = groupsFor(question, questionIndex, graphs);
    const stepCount = groups.reduce((count, group) => count + group.steps.length, 0);
    const compactPage = !finalReference && fullWidthQuestions && stepCount >= 4;
    const stackedHeight = fullWidthQuestions ? finalReference ? .48 : stepCount >= 5 ? .22 : compactPage ? .26 : .48 : undefined;
    const original = originalProblemTex(job, question.number, assets, stackedHeight);
    const sourceMapping = job.originalProblems?.find(item => item.questionNumber === question.number);
    const mappedAsset = sourceMapping && sourceAssets.find(asset => asset.sourceFileIds.includes(sourceMapping.fileId));
    const mappedPanels = sourceMapping && mappedAsset && mappedSourcePanelsTex(sourceMapping, mappedAsset, sourceHeight(question, finalReference));
    if (fullWidthQuestions) {
      if (mappedAsset) usedAssets.add(mappedAsset);
      const handwritten = job.mode === 'supplement' && mappedAsset?.role !== 'exam_and_handwriting'
        ? question.steps.map(step => step.originalStep).filter(text => text.trim()) : [];
      const content = [mappedPanels || (original ? String.raw`\noindent\makebox[\linewidth][c]{${original}}` : formatProblem(question.problemText)),
        ...handwritten.map(text => `\\par ${formatBookletInlineTex(text)}`)].join('\n');
      body.push(`\\${sourceMacro}{${number}}{${content}}`);
    } else if (pairedSource) {
      const heading = finalReference && job.mode === 'solve' ? '' : number;
      body.push(`\\${sourceMacro}{${heading}}{${pairedSource}}`);
    } else if (!sourceAssets.length) {
      const handwritten = job.mode === 'supplement'
        ? single && job.teacherText.trim() ? [job.teacherText] : question.steps.map((step) => step.originalStep).filter((step) => step.trim())
        : [];
      const heading = `${number ? `${number}번 · ` : ''}${job.mode === 'supplement' ? '문제·손풀이' : '문제'}`;
      const label = number ? `\\textbf{${number}.}\\ ` : '';
      const content = [label + formatProblem(question.problemText), ...handwritten.map((step) => `\\par ${formatBookletInlineTex(step)}`)].join('\n');
      body.push(stacked ? String.raw`\baeksinstackedsource{}{${content}}` : String.raw`\baeksinsourcepage{${heading}}` + '\n' + content);
    }
    if (!fullWidthQuestions && (!stacked || (!pairedSource && sourceAssets.length))) {
      body.push(original ? String.raw`\baeksinimagerecap{${number}}{${original}}` : String.raw`\baeksinrecap{${number}}{${formatProblem(question.problemText)}}`);
    }
    if (compactPage) body.push(String.raw`\begingroup\setlength{\baeksingroupgap}{6bp}\setlength{\baeksinreferencegap}{5bp}`,
      String.raw`\setlength{\parskip}{3bp}\setlength{\jot}{1bp}\abovedisplayskip=4bp\belowdisplayskip=4bp\abovedisplayshortskip=4bp\belowdisplayshortskip=4bp`);
    const supplementStart = body.length;
    if (stacked) body.push(String.raw`\begin{${referenceEnvironment}}{${referenceTitle}}`);
    if (finalReference && groups.length === 0 && question.firstDecision.trim()) body.push(formatBookletInlineTex(question.firstDecision));
    if (handSolution && !finalReference) body.push(...handSolutionLead(question, !fullWidthQuestions));
    let stageNumber = 1;
    for (const [groupIndex, group] of groups.entries()) {
      if (job.pdfDesign?.stepLayout === 'separate' && groupIndex > 0) {
        if (stacked) body.push(String.raw`\end{${referenceEnvironment}}`);
        body.push(String.raw`\clearpage`);
        if (stacked) body.push(String.raw`\begin{${referenceEnvironment}}{${referenceTitle}}`);
      } else if (finalReference && groupIndex > 0) {
        body.push(String.raw`\par\addvspace{\baselineskip}`);
      }
      const answer = groupIndex === groups.length - 1 ? question.answer : '';
      body.push(...studentGroup(group, answer, question.problemText, stacked, handSolution ? stageNumber : undefined, finalReference));
      stageNumber += group.steps.length;
    }
    if (!groups.length && question.answer.trim()) body.push(studentAnswer(question.answer));
    if (stacked) body.push(String.raw`\end{${referenceEnvironment}}`);
    if (useCompactSupplement && groups.length && (mappedPanels || (pairedSource && sourceAssets[0]?.sourcePanels))) {
      const fallbackTex = body.splice(supplementStart).join('\n');
      body.push(splitSupplementTex({ question, questionIndex, graphs, referenceTitle, fallbackTex }));
    }
    if (compactPage) body.push(String.raw`\endgroup`);
  }
  if (fullWidthQuestions) {
    const fullyMapped = questions.every(question => job.originalProblems?.some(item => item.questionNumber === question.number));
    body.push(...sourcePages(fullyMapped ? sourceAssets.filter(asset => !usedAssets.has(asset)) : sourceAssets, job.mode));
  }
  return [...body, String.raw`\end{document}`].join('\n');
}
