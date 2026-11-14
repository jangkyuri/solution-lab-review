import type { Job, Question } from '../shared/contracts.ts';
import { HAND_SOLUTION_PRODUCTION_VERSION, studentQuestionNumber } from '../shared/hand-solution-output.ts';
import { renderBookletStep } from './pdf-booklet-layout.ts';
import { handSolutionLead, studentAnswer } from './pdf-hand-solution.ts';
import { originalProblemTex } from './pdf-originals.ts';
import { escapeTex, formatBookletInlineTex, safeMath } from './pdf-safety.ts';
import type { PdfAsset } from './pdf-template.ts';

export type PdfPurpose = 'review' | 'export';

export function usesPairedHandSolutionPdf(job: Job, purpose: PdfPurpose): boolean {
  return purpose === 'review' && job.result?.productionVersion === HAND_SOLUTION_PRODUCTION_VERSION && job.result.questions.length > 1;
}

export const PAIRED_HAND_SOLUTION_PREAMBLE = String.raw`
\newdimen\solutionpairwidth
\newdimen\solutionpairlimit
\newbox\solutionpairleft
\newbox\solutionpairright
\newbox\solutionpairleftpage
\newbox\solutionpairrightpage
\newsavebox{\solutionpairgraphic}
\newcommand{\solutionpairfit}[1]{%
  \sbox{\solutionpairgraphic}{#1}%
  \ifdim\wd\solutionpairgraphic>\linewidth
    \sbox{\solutionpairgraphic}{\resizebox{\linewidth}{!}{\usebox{\solutionpairgraphic}}}%
  \fi
  \ifdim\dimexpr\ht\solutionpairgraphic+\dp\solutionpairgraphic\relax>.65\textheight
    \resizebox*{!}{.65\textheight}{\usebox{\solutionpairgraphic}}%
  \else\usebox{\solutionpairgraphic}\fi
}
\newcommand{\solutionpairmath}[1]{\par\noindent\makebox[\linewidth][c]{\solutionpairfit{\(\displaystyle #1\)}}\par}
\newcommand{\solutionpairsource}[1]{\par\noindent\makebox[\linewidth][c]{\solutionpairfit{#1}}\par}
\newcommand{\solutionpairbody}[1]{%
  \hsize=\solutionpairwidth\linewidth=\solutionpairwidth\columnwidth=\solutionpairwidth
  \raggedright\setlength{\parskip}{3bp}\setlength{\jot}{1bp}%
  \baselineskip=.9\baselineskip\lineskiplimit=2bp\lineskip=2.5bp
  #1\par
}
\newcommand{\solutionpairsplit}[2]{%
  \ifdim\dimexpr\ht#1+\dp#1\relax>\solutionpairlimit
    \setbox#2=\vsplit#1 to \solutionpairlimit
  \else\setbox#2=\box#1\fi
}
\newcommand{\solutionpairpagecolumn}[2]{\vtop{%
  \hsize=\solutionpairwidth\vskip0pt\color{ink}%
  \ifvoid#1\else
    \ifnum\solutionpaircontinued=1\relax
      \noindent\baeksinlabel{문제 #2 이어서}\par\vskip6bp
    \fi
    \unvbox#1%
  \fi}}
\newcommand{\solutionpair}[4]{%
  \clearpage\begingroup
  \solutionpairwidth=\dimexpr(\linewidth-16bp)/2\relax
  \solutionpairlimit=\dimexpr\textheight-12bp\relax
  \splittopskip=\topskip\splitmaxdepth=\maxdepth
  \setbox\solutionpairleft=\vbox{\solutionpairbody{#2}}%
  \setbox\solutionpairright=\vbox{\solutionpairbody{#4}}%
  \def\solutionpaircontinued{0}%
  \loop
    \solutionpairsplit\solutionpairleft\solutionpairleftpage
    \solutionpairsplit\solutionpairright\solutionpairrightpage
    \nointerlineskip\hbox to \linewidth{%
      \solutionpairpagecolumn\solutionpairleftpage{#1}\hfil
      {\color{rulegray}\vrule width .4bp}\hfil
      \solutionpairpagecolumn\solutionpairrightpage{#3}}%
    \def\solutionpaircontinued{1}%
    \solutionpairlimit=\dimexpr\textheight-30bp\relax
    \clearpage
  \unless\ifdim\dimexpr\ht\solutionpairleft+\dp\solutionpairleft+\ht\solutionpairright+\dp\solutionpairright\relax=0pt
  \repeat\endgroup
}
`;

function pairedProblem(text: string): string {
  return text.split(/(\\\[[\s\S]*?\\\])/gu).map((part, index) => {
    if (index % 2 === 0) return formatBookletInlineTex(part);
    const math = safeMath(part.slice(2, -2));
    return math === null ? formatBookletInlineTex(part) : String.raw`\solutionpairmath{${math}}`;
  }).join('');
}

function sourceIdFor(job: Job, questionNumber: string): string | undefined {
  return job.originalProblems?.find(original => original.questionNumber === questionNumber)?.fileId;
}

function pairedQuestion(job: Job, question: Question, questionIndex: number, assets: readonly PdfAsset[], graphs: ReadonlyMap<string, string>): string {
  const number = escapeTex(studentQuestionNumber(question.number));
  const original = originalProblemTex(job, question.number, assets);
  const source = original ? String.raw`\solutionpairsource{${original}}`
    : `${number ? String.raw`\textbf{${number}.}\ ` : ''}${pairedProblem(question.problemText)}`;
  const sourceId = sourceIdFor(job, question.number);
  const combined = sourceId !== undefined && assets.some(asset => asset.role === 'exam_and_handwriting' && asset.sourceFileIds.includes(sourceId));
  const handwriting = job.mode === 'supplement' && !combined ? question.steps.map(step => step.originalStep).filter(text => text.trim()) : [];
  const parts = [source, ...handwriting.map(text => pairedProblem(text)),
    String.raw`\par\vskip4bp{\color{rulegray}\hrule height .4bp}\vskip4bp`,
    ...(job.mode === 'supplement' ? [String.raw`{\labeltext\bfseries\color{baeksinolive}손풀이 참고}\par`] : []),
    ...handSolutionLead(question)];
  let stageNumber = 0;
  for (const [stepIndex, step] of question.steps.entries()) {
    const graphPath = graphs.get(`${questionIndex}-${stepIndex}`);
    const zoomPath = graphs.get(`${questionIndex}-${stepIndex}:zoom`);
    if (!step.explanation.trim() && !step.latex.trim() && !step.booklet && !graphPath) continue;
    stageNumber += 1;
    parts.push(renderBookletStep({ step, graphPath, zoomPath, stageNumber, paired: true }, '', question.problemText));
  }
  if (question.answer.trim()) parts.push(studentAnswer(question.answer));
  return parts.join('\n\\par\n')
    .replace(/\\\([\s\S]*?\\\)/gu, math => String.raw`\solutionpairfit{${math}}`);
}

export function renderPairedHandSolutions(job: Job, assets: readonly PdfAsset[], graphs: ReadonlyMap<string, string>): string {
  const questions = job.result?.questions ?? [];
  const body = [String.raw`\baeksinrunning{}`];
  for (let index = 0; index < questions.length; index += 2) {
    const left = questions[index];
    const right = questions[index + 1];
    if (!left) break;
    const number = (question: Question) => escapeTex(studentQuestionNumber(question.number));
    const leftTex = pairedQuestion(job, left, index, assets, graphs);
    const rightTex = right ? pairedQuestion(job, right, index + 1, assets, graphs) : '';
    body.push(String.raw`\solutionpair{${number(left)}}{${leftTex}}{${right ? number(right) : ''}}{${rightTex}}`);
  }
  for (const asset of assets) {
    if (job.mode === 'solve' && asset.role === 'handwriting') continue;
    if (asset.role === 'exam_and_handwriting' && questions.every(question => {
      const sourceId = sourceIdFor(job, question.number);
      return sourceId !== undefined && asset.sourceFileIds.includes(sourceId);
    })) continue;
    if (asset.mimeType === 'application/pdf') {
      body.push(String.raw`\includepdf[pages=-,scale=.90,pagecommand={\baeksinrunning{첨부 원본}}]{${asset.localName}}`);
    } else {
      body.push(String.raw`\baeksinsourcepage{첨부 원본}\null\vfill\solutionpairsource{\includegraphics[width=\linewidth,height=.83\textheight,keepaspectratio]{${asset.localName}}}\vfill\null`);
    }
  }
  return [...body, String.raw`\end{document}`].join('\n');
}
