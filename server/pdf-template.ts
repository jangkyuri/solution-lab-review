import type { Job, Question } from '../shared/contracts.ts';
import { HAND_SOLUTION_PRODUCTION_VERSION, studentQuestionNumber } from '../shared/hand-solution-output.ts';
import { formatSolutionIntegralNotation } from '../shared/integral-notation.ts';
import { baeksinBookletPreamble, renderBaeksinBooklet } from './pdf-baeksin.ts';
import { DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import type { PdfDesign } from '../shared/pdf-design.ts';
import { escapeTex, formatInlineTex, mathBlock } from './pdf-safety.ts';
import { isSingleQuestionSource, originalProblemTex, validateOriginalProblems } from './pdf-originals.ts';
import { handSolutionLead, handSolutionStage, studentAnswer } from './pdf-hand-solution.ts';
import { bookletTable } from './pdf-booklet-extras.ts';
import { PAIRED_HAND_SOLUTION_PREAMBLE, renderPairedHandSolutions, usesPairedHandSolutionPdf } from './pdf-paired-hand-solution.ts';
import type { PdfPurpose } from './pdf-paired-hand-solution.ts';

export type PdfAsset = {
  readonly sourceFileIds: readonly string[];
  readonly localName: string;
  readonly name: string;
  readonly mimeType: string;
  readonly role: 'exam' | 'handwriting' | 'exam_and_handwriting';
  readonly imageSize?: { readonly width: number; readonly height: number };
  readonly sourcePanels?: readonly [string, string];
  readonly sourcePanelMaxWidthBp?: number;
  readonly mappedSourceSplits?: ReadonlyMap<string, { readonly pageHeight: number; readonly seam: number; readonly ratio: number }>;
};

const attachmentLabels = {
  exam: '문제',
  handwriting: '손풀이',
  exam_and_handwriting: '문제 및 손풀이',
} as const;

const marginSizes = {
  compact: { side: 16, top: 18, bottom: 18 },
  standard: { side: 20, top: 22, bottom: 20 },
  wide: { side: 25, top: 25, bottom: 25 },
} as const;

const baeksinMarginSizes = {
  compact: { side: 22, top: 26, bottom: 26 },
  standard: { side: 26, top: 30, bottom: 30 },
  wide: { side: 38, top: 42, bottom: 42 },
} as const;

const finishedMarginSizes = {
  compact: { side: 14, top: 26, bottom: 26 },
  standard: { side: 17, top: 30, bottom: 30 },
  wide: { side: 32, top: 42, bottom: 42 },
} as const;

function pdfPreamble(design: PdfDesign, title: string, mode: Job['mode'], handSolution = false, paired = false): string {
  const baeksin = design.template === 'baeksin-v16';
  const { side, top, bottom } = (baeksin ? design.sourceLayout === 'stacked-reference' ? finishedMarginSizes : baeksinMarginSizes : marginSizes)[design.margins];
  const unit = baeksin ? 'bp' : 'mm';
  const bodySize = (11.2 + design.fontSize - 11).toFixed(1);
  const leading = (18.2 + (design.fontSize - 11) * 1.5).toFixed(1);
  const recapHeading = baeksin
    ? String.raw`{\labeltext\color{muted}\fontsize{8bp}{10bp}\selectfont ${escapeTex(title.slice(0, 40))}\hfill #1번 · #3}\par\vspace{5bp}`
    : String.raw`{\labeltext\bfseries\color{accent}\if\relax\detokenize{#1}\relax\else{}문항 #1 · \fi{}#3}\par\vspace{6pt}`;
  return String.raw`\documentclass[${baeksin ? 10 : design.fontSize}pt,a4paper]{article}
\usepackage[left=${side}${unit},right=${side}${unit},top=${top}${unit},bottom=${bottom}${unit}${baeksin ? ",headheight=12bp,headsep=7bp" : ""}]{geometry}
\usepackage{fontspec,amsmath,amssymb,unicode-math,graphicx,xcolor,fancyhdr,pdfpages,needspace}
${baeksin || paired ? String.raw`\usepackage{tikz,array}` : handSolution ? String.raw`\usepackage{array}` : ''}
${baeksin && design.sourceLayout === 'stacked-reference' ? String.raw`\usepackage{tcolorbox}
\tcbuselibrary{breakable,skins}` : ''}
\setmainfont[Path=C:/Windows/Fonts/,BoldFont=HANBatangB.ttf]{HANBatang.ttf}
\newfontfamily\labeltext[Path=C:/Windows/Fonts/,BoldFont=malgunbd.ttf]{malgun.ttf}
\setmathfont[Path=C:/Windows/Fonts/,FontIndex=1]{cambria.ttc}
\XeTeXlinebreaklocale "ko"
\XeTeXlinebreakskip=0pt plus 1pt
\definecolor{accent}{HTML}{3C5D72}
\definecolor{warm}{HTML}{AD7645}
\definecolor{muted}{HTML}{686868}
\definecolor{rulegray}{HTML}{${baeksin ? 'B8B8B8' : 'C7D0D7'}}
\definecolor{ink}{HTML}{202020}
\setlength{\parindent}{0pt}
\setlength{\parskip}{${baeksin ? '5bp' : '6pt'}}
\setlength{\emergencystretch}{3em}
\linespread{${baeksin ? '1' : '1.18'}}
\pagestyle{plain}
\newsavebox{\problemrecap}
\newlength{\recapheight}
\newcommand{\notetext}[1]{{\labeltext\color{muted}\fontsize{9pt}{13pt}\selectfont #1}\par}
\newcommand{\sectionlabel}[1]{\par\Needspace{55pt}{\labeltext\bfseries\color{accent}\fontsize{12pt}{17pt}\selectfont #1}\par}
\newcommand{\setsupplementcontent}[4]{%
  \clearpage
  \sbox{\problemrecap}{\begin{minipage}{\dimexpr\paperwidth-${side * 2}${unit}\relax}
    ${recapHeading}
    {\fontsize{${design.fontSize - 0.5}pt}{${design.fontSize + 5}pt}\selectfont #2}\par\vspace{6pt}
    {\color{rulegray}\hrule height .4pt}
  \end{minipage}}
  \setlength{\recapheight}{\dimexpr\ht\problemrecap+\dp\problemrecap\relax}
  \ifdim\recapheight>#4\PackageError{solutionlab}{Problem recap too long}{Split this question before exporting.}\fi
  \newgeometry{left=${side}${unit},right=${side}${unit},top=\dimexpr${top}${unit}+\recapheight+10pt\relax,bottom=${bottom}${unit},headheight=\recapheight,headsep=10pt}
  \fancyhf{}\renewcommand{\headrulewidth}{0pt}
  \fancyhead[C]{\usebox{\problemrecap}}
  \fancyfoot[R]{\labeltext\color{muted}\fontsize{9pt}{12pt}\selectfont\thepage}
  \pagestyle{fancy}
}
\newcommand{\setsupplement}[3]{\setsupplementcontent{#1}{#2}{#3}{105mm}}
\newcommand{\setimagesupplement}[3]{\setsupplementcontent{#1}{#2}{#3}{120mm}}
\newcommand{\originalpage}{\clearpage\restoregeometry\pagestyle{plain}}
${baeksin || paired ? baeksinBookletPreamble(title, side, top, bottom, mode, baeksin && design.sourceLayout === 'stacked-reference') : ''}
${paired ? PAIRED_HAND_SOLUTION_PREAMBLE : ''}
\begin{document}
${baeksin ? String.raw`\color{ink}\fontsize{${bodySize}bp}{${leading}bp}\selectfont\lineskiplimit=2.5bp\lineskip=3bp` : ''}
`;
}

function attachmentPages(assets: readonly PdfAsset[], handSolution: boolean): string {
  if (assets.length === 0) return '';
  const lead = handSolution ? [] : [String.raw`\sectionlabel{첨부 원본 묶음}`, String.raw`\notetext{첨부한 시험지와 손풀이의 전체 원본입니다. 여러 문항이 있는 파일은 자동으로 문항별 분할·매칭되었다고 간주하지 않습니다. 뒤쪽 문항별 전사와 원본을 대조해 주세요.}`];
  for (const asset of assets) {
    if (!handSolution) lead.push(`\\notetext{${attachmentLabels[asset.role]} · ${escapeTex(asset.name)}}`);
    if (asset.mimeType === 'application/pdf') {
      lead.push(`\\includepdf[pages=-,pagecommand={\\thispagestyle{empty}}]{${asset.localName}}`);
    } else {
      lead.push(`\\begin{center}\\includegraphics[width=\\linewidth,height=.78\\textheight,keepaspectratio]{${asset.localName}}\\end{center}\\clearpage`);
    }
  }
  return lead.join('\n');
}

function formatReviewTex(value: string): string {
  return formatInlineTex(value
    .replace(/\bmethodExamples\b/gu, '참고 풀이 기록')
    .replace(/\bobservedOrder\b/gu, '원래 풀이 순서'));
}

function standardHandSolution(question: Question, questionIndex: number, graphs: ReadonlyMap<string, string>, stepLayout: PdfDesign['stepLayout']): string[] {
  const body = handSolutionLead(question);
  let number = 0;
  for (const [stepIndex, step] of question.steps.entries()) {
    const graph = graphs.get(`${questionIndex}-${stepIndex}`);
    const table = step.booklet?.table ? bookletTable(step.booklet.table) : '';
    if (!step.explanation.trim() && !step.latex.trim() && !graph && !table) continue;
    number += 1;
    if (stepLayout === 'separate' && number > 1) body.push(String.raw`\clearpage`);
    body.push(String.raw`\sectionlabel{${handSolutionStage(number, step.title)}}`);
    if (graph) {
      body.push(String.raw`\begin{center}\includegraphics[width=\linewidth,height=85mm,keepaspectratio]{${graph}}\end{center}`);
      const caption = step.graph?.explanation.trim();
      if (caption && !step.explanation.includes(caption)) body.push(formatInlineTex(caption));
    }
    if (table) body.push(table);
    body.push(formatInlineTex(step.explanation));
    if (step.latex.trim()) body.push(mathBlock(step.latex));
  }
  if (question.answer.trim()) body.push(studentAnswer(question.answer, false));
  return body;
}

export function renderPdfTex(sourceJob: Job, assets: readonly PdfAsset[], graphs: ReadonlyMap<string, string>, purpose: PdfPurpose = 'export'): string {
  if (sourceJob.result === null) return '';
  validateOriginalProblems(sourceJob);
  const job = { ...sourceJob, result: formatSolutionIntegralNotation(sourceJob.result) };
  const { provenance, references } = job.result;
  const handSolution = job.result.productionVersion === HAND_SOLUTION_PRODUCTION_VERSION;
  const hasReferences = references.length > 0 || (provenance?.sampleIds.length ?? 0) > 0;
  const originalHeading = job.mode === 'solve' ? '문제' : handSolution ? '문제·손풀이' : '문제와 원래 흐름';
  const solutionHeading = job.mode === 'solve' ? '풀이' : '풀이 보충';
  const design: PdfDesign = job.pdfDesign ?? DEFAULT_PDF_DESIGN;
  if (usesPairedHandSolutionPdf(job, purpose)) {
    return pdfPreamble(design, job.title, job.mode, true, true) + renderPairedHandSolutions(job, assets, graphs);
  }
  if (design.template === 'baeksin-v16') {
    return pdfPreamble(design, job.title, job.mode) + renderBaeksinBooklet({ ...job, pdfDesign: design }, assets, graphs, purpose);
  }
  const sourceAssets = job.mode === 'solve' ? assets.filter(asset => asset.role !== 'handwriting') : assets;
  const body = [pdfPreamble(design, job.title, job.mode, handSolution), attachmentPages(sourceAssets, handSolution)];
  for (const [questionIndex, question] of job.result.questions.entries()) {
    const original = originalProblemTex(job, question.number, assets);
    const number = escapeTex(handSolution ? studentQuestionNumber(question.number) : question.number);
    body.push('\\originalpage', `\\sectionlabel{${number || !handSolution ? `문항 ${number} · ` : ''}${originalHeading}}`);
    body.push(original ?? formatInlineTex(question.problemText));
    if (job.mode === 'supplement' && job.teacherText.trim() && isSingleQuestionSource(job)) {
      body.push(handSolution ? '\\sectionlabel{손풀이}' : '\\sectionlabel{직접 입력한 손풀이}', formatInlineTex(job.teacherText));
    } else if (handSolution && job.mode === 'supplement' && !sourceAssets.some(asset => asset.role !== 'exam')) {
      const transcribed = question.steps.map(step => step.originalStep).filter(text => text.trim());
      if (transcribed.length) body.push('\\sectionlabel{손풀이}', ...transcribed.map(formatInlineTex));
    }
    if (handSolution) {
      body.push(`\\${original ? 'setimagesupplement' : 'setsupplement'}{${number}}{${original ?? formatInlineTex(question.problemText)}}{${solutionHeading}}`,
        ...standardHandSolution(question, questionIndex, graphs, design.stepLayout));
      continue;
    }
    const originals = question.steps.filter((step) => step.originalStep.trim());
    if (originals.length > 0) {
      body.push('\\sectionlabel{판독한 원문}', '\\notetext{자동 판독 결과입니다.}');
      for (const step of originals) {
        body.push(`{\\labeltext\\bfseries ${escapeTex(step.id || step.title)}}\\par`, formatInlineTex(step.originalStep));
        if (step.branch !== null || step.after.length > 0) {
          body.push(`\\notetext{${escapeTex([step.branch ? `분기: ${step.branch}` : '', step.after.length ? `연결 단계: ${step.after.join(', ')}` : '독립 출발 단계'].filter(Boolean).join(' · '))}}`);
        }
      }
    }
    body.push(`\\${original ? 'setimagesupplement' : 'setsupplement'}{${escapeTex(question.number)}}{${original ?? formatInlineTex(question.problemText)}}{${solutionHeading}}`);
    body.push('\\sectionlabel{첫 판단}', formatInlineTex(question.firstDecision));
    if (question.variables.length > 0) body.push(`\\notetext{원래 미지수: ${escapeTex(question.variables.join(', '))}}`);
    for (const [stepIndex, step] of question.steps.entries()) {
      if (design.stepLayout === 'separate' && stepIndex > 0) body.push('\\clearpage');
      const marker = design.template === 'baeksin-v16' && stepIndex < 26
        ? String.fromCharCode(65 + stepIndex) : step.id || String(stepIndex + 1);
      body.push(`\\sectionlabel{${escapeTex(marker)} · ${escapeTex(step.title)}}`);
      if (step.after.length > 0 || step.branch !== null) {
        body.push(`\\notetext{${escapeTex([step.after.length ? `앞선 연결: ${step.after.join(', ')}` : '독립 출발', step.branch ? `분기: ${step.branch}` : ''].filter(Boolean).join(' · '))}}`);
      }
      body.push(formatInlineTex(step.explanation));
      if (step.latex.trim()) body.push(mathBlock(step.latex));
      if (step.evidence.trim()) body.push(`\\notetext{근거 · ${formatInlineTex(step.evidence)}}`);
      const graph = graphs.get(`${questionIndex}-${stepIndex}`);
      if (graph !== undefined) {
        body.push(`\\begin{center}\\includegraphics[width=\\linewidth,height=85mm,keepaspectratio]{${graph}}\\end{center}`);
        if (step.graph !== null) body.push(formatInlineTex(step.graph.explanation));
      }
    }
    if (question.answer.trim()) body.push(studentAnswer(question.answer, false));
    const checks = [...question.checks.math, ...question.checks.sequence, ...question.checks.graph];
    if (checks.length > 0) body.push('\\sectionlabel{검토 기록}', ...checks.map((item) => `\\notetext{${formatReviewTex(item)}}`));
  }
  if (handSolution) return [...body, '\\end{document}'].join('\n\n');
  if (job.reviewNote.trim()) body.push('\\originalpage', '\\sectionlabel{선생님 검토 메모}', formatInlineTex(job.reviewNote));
  if (job.result.limitations.length > 0) {
    body.push('\\originalpage', '\\sectionlabel{사용 범위와 주의}');
    for (const item of job.result.limitations) {
      const limitation = provenance !== null && !hasReferences
        ? item.replace(/^기준 표본의 관찰 기록을 참고한 검토 전 초안입니다\./u, '검토 전 초안입니다.')
        : item;
      body.push(formatReviewTex(limitation));
    }
  }
  if (hasReferences || provenance !== null) {
    const referenceHeading = hasReferences ? '참고한 풀이 기록' : '풀이 기록 조회 결과';
    body.push('\\originalpage', `\\sectionlabel{${referenceHeading}}`);
    for (const reference of references) {
      body.push(`{\\labeltext\\bfseries ${escapeTex(reference.id)} · ${escapeTex(reference.title)}}\\par`, formatInlineTex(reference.reason));
    }
    if (provenance !== null) {
      body.push(`\\notetext{기록 버전 · ${escapeTex(provenance.snapshotId)}}`);
      if (provenance.sampleIds.length > 0) {
        body.push(`\\notetext{근거 문항 · ${escapeTex(provenance.sampleIds.join(', '))}}`);
        body.push('\\notetext{원본에서 관찰한 풀이 구조를 참고한 기록입니다. 이 결과에 대한 선생님의 검토와 구별합니다.}');
      } else if (!hasReferences) {
        body.push('\\notetext{이 문제에 적용한 참고 문항이 없습니다.}');
      }
    }
  }
  body.push('\\end{document}');
  return body.join('\n\n');
}
