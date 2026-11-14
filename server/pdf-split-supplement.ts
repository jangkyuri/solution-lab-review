import type { Question } from '../shared/contracts.ts';
import { renderBookletStep } from './pdf-booklet-layout.ts';
import { studentAnswer } from './pdf-hand-solution.ts';
import { escapeTex, formatBookletInlineTex } from './pdf-safety.ts';

export const SPLIT_SUPPLEMENT_PREAMBLE = String.raw`
\newsavebox{\baeksinsplitasset}
\newcommand{\baeksinsplitfit}[2]{\begingroup
  \sbox{\baeksinsplitasset}{#2}%
  \ifdim\wd\baeksinsplitasset>\linewidth
    \sbox{\baeksinsplitasset}{\resizebox{\linewidth}{!}{\usebox{\baeksinsplitasset}}}%
  \fi
  \ifdim\dimexpr\ht\baeksinsplitasset+\dp\baeksinsplitasset\relax>#1
    \resizebox*{!}{#1}{\usebox{\baeksinsplitasset}}%
  \else\usebox{\baeksinsplitasset}\fi\endgroup}
\newcommand{\baeksinsplitgraphic}[2]{%
  \par\noindent\makebox[\linewidth][c]{\baeksinsplitfit{#1}{#2}}\par}
\newcommand{\baeksinsplitside}[2]{%
  \par\noindent\begin{minipage}[t]{.63\linewidth}\vspace{0pt}\raggedright #1\end{minipage}\hfill%
  \begin{minipage}[t]{.35\linewidth}\vspace{0pt}#2\end{minipage}\par}
\ExplSyntaxOn
\int_new:N \l__baeksin_split_stage_int
\int_new:N \l__baeksin_split_after_int
\dim_new:N \l__baeksin_split_width_dim
\dim_new:N \l__baeksin_split_gap_dim
\dim_new:N \l__baeksin_split_total_dim
\dim_new:N \l__baeksin_split_left_dim
\dim_new:N \l__baeksin_split_best_dim
\dim_new:N \l__baeksin_split_candidate_dim
\box_new:N \l__baeksin_split_supplement_box
\cs_new_protected:Npn \baeksinsplitstage #1 {
  \int_incr:N \l__baeksin_split_stage_int
  \box_if_exist:cF { l__baeksin_split_stage_\int_use:N \l__baeksin_split_stage_int _box }
    { \box_new:c { l__baeksin_split_stage_\int_use:N \l__baeksin_split_stage_int _box } }
  \vbox_set:cn { l__baeksin_split_stage_\int_use:N \l__baeksin_split_stage_int _box } {
    \hsize=\l__baeksin_split_width_dim \linewidth=\hsize \columnwidth=\hsize
    \raggedright #1 \par
  }
  \dim_add:Nn \l__baeksin_split_total_dim { \__baeksin_stage_height:n { \int_use:N \l__baeksin_split_stage_int } + \l__baeksin_split_gap_dim }
}
\cs_new:Npn \__baeksin_stage_height:n #1 {
  \box_ht:c { l__baeksin_split_stage_#1_box } + \box_dp:c { l__baeksin_split_stage_#1_box }
}
\cs_new_protected:Npn \__baeksin_render_column:nn #1#2 {
  \vtop{ \hsize=\l__baeksin_split_width_dim \vskip0pt
    \int_step_inline:nnn {#1} {#2} {
      \int_compare:nNnT {##1} > {#1} { \vskip\l__baeksin_split_gap_dim }
      \nointerlineskip\box_use:c { l__baeksin_split_stage_##1_box }
    }
  }
}
\cs_new_protected:Npn \__baeksin_render_stages: {
  \int_compare:nNnTF { \l__baeksin_split_stage_int } < { 2 }
    { \__baeksin_render_column:nn { 1 } { \l__baeksin_split_stage_int } }
    {
      \dim_set:Nn \l__baeksin_split_best_dim { \maxdimen }
      \dim_zero:N \l__baeksin_split_left_dim
      \int_step_inline:nn { \l__baeksin_split_stage_int - 1 } {
        \dim_add:Nn \l__baeksin_split_left_dim { \__baeksin_stage_height:n {##1} + \l__baeksin_split_gap_dim }
        \dim_set:Nn \l__baeksin_split_candidate_dim { \dim_max:nn
          { \l__baeksin_split_left_dim - \l__baeksin_split_gap_dim }
          { \l__baeksin_split_total_dim - \l__baeksin_split_left_dim - \l__baeksin_split_gap_dim }
        }
        \dim_compare:nNnT { \l__baeksin_split_candidate_dim } < { \l__baeksin_split_best_dim } {
          \dim_set_eq:NN \l__baeksin_split_best_dim \l__baeksin_split_candidate_dim
          \int_set:Nn \l__baeksin_split_after_int {##1}
        }
      }
      \hbox to \linewidth {
        \__baeksin_render_column:nn { 1 } { \l__baeksin_split_after_int } \hfil
        \__baeksin_render_column:nn { \l__baeksin_split_after_int + 1 } { \l__baeksin_split_stage_int }
      }
    }
}
\cs_new_protected:Npn \baeksinsupplement #1#2#3#4#5#6#7 {
  \par\group_begin:
  \vbox_set:Nn \l__baeksin_split_supplement_box {
    \begin{tcolorbox}[enhanced,colback=white,colframe=rulegray,boxrule=.45bp,arc=4bp,
      boxsep=0bp,left=8.55bp,right=8.55bp,top=5bp,bottom=7bp,before~skip=0bp,after~skip=0bp,
      colbacktitle=white,coltitle=baeksinolive,titlerule=0bp,toptitle=3bp,bottomtitle=5bp,
      fonttitle=\labeltext\bfseries\fontsize{10bp}{12bp}\selectfont,title={#1}]
      \fontsize{#3bp}{#4bp}\selectfont
      \setlength{\parskip}{0pt} \setlength{\jot}{1bp}
      \lineskiplimit=2bp \lineskip=2bp
      \dim_set:Nn \l__baeksin_split_gap_dim { \baselineskip }
      \dim_set:Nn \l__baeksin_split_width_dim { \linewidth }
      \int_compare:nNnT {#2} > {1} {
        \dim_set:Nn \l__baeksin_split_width_dim { (\linewidth - 15bp) / 2 }
      }
      \int_zero:N \l__baeksin_split_stage_int
      \dim_zero:N \l__baeksin_split_total_dim
      \cs_set_protected:Npn \baeksinleftmath { \peek_meaning_ignore_spaces:NTF [ { \__baeksin_split_formula:w } { \__baeksin_split_formula:w [] } }
      #5
      \__baeksin_render_stages:
      #6
    \end{tcolorbox}
  }
  \dim_compare:nNnTF { \box_ht:N \l__baeksin_split_supplement_box + \box_dp:N \l__baeksin_split_supplement_box + 2bp } > { \pagegoal - \pagetotal }
    { \group_end: #7 }
    { \nointerlineskip\box_use:N \l__baeksin_split_supplement_box \group_end: }
}
\cs_new_protected:Npn \__baeksin_split_formula:w [#1]#2 {
  \par\noindent
  \sbox{\baeksinsplitasset}{#1\(\displaystyle #2\)}
  \ifdim\wd\baeksinsplitasset>\linewidth
    \group_begin:
      \renewcommand{\baeksinmathbreak}[1]{\\}
      \baeksinsplitfit{.65\textheight}{#1\(\displaystyle\begin{gathered}#2\end{gathered}\)}
    \group_end:
  \else\usebox{\baeksinsplitasset}\fi\par
}
\ExplSyntaxOff
`;

type SplitSupplement = {
  readonly question: Question;
  readonly questionIndex: number;
  readonly graphs: ReadonlyMap<string, string>;
  readonly referenceTitle: string;
  readonly fallbackTex: string;
};

export function splitSupplementTex({ question, questionIndex, graphs, referenceTitle, fallbackTex }: SplitSupplement): string {
  const steps = question.steps.flatMap((step, index) => {
    const graphPath = graphs.get(`${questionIndex}-${index}`);
    const zoomPath = graphs.get(`${questionIndex}-${index}:zoom`);
    return step.explanation.trim() || step.latex.trim() || step.booklet || graphPath || zoomPath ? [{ step, graphPath, zoomPath }] : [];
  });
  const figureCount = steps.filter(({ graphPath }) => graphPath).length;
  const dense = figureCount >= 4 && steps.length >= 6;
  const rendered = steps.map(({ step, graphPath, zoomPath }, index) => {
    const proseLength = step.explanation.length;
    const smallFigure = step.booklet?.figure === 'small';
    const sideFigure = dense && proseLength >= 75 && proseLength <= 160 && !zoomPath && !step.booklet?.table;
    const figureHeight = sideFigure ? 76 : smallFigure ? 80 : dense ? 125 : figureCount >= 3 ? 114 : 137;
    const stage = renderBookletStep({ step, graphPath, zoomPath, stageNumber: index + 1, splitColumn: { figureHeight, sideFigure } }, '', question.problemText);
    return String.raw`\baeksinsplitstage{${stage}}`;
  });
  if (!rendered.length && question.firstDecision.trim()) {
    rendered.push(String.raw`\baeksinsplitstage{${formatBookletInlineTex(question.firstDecision)}}`);
  }
  const answer = studentAnswer(question.answer);
  return String.raw`\baeksinsupplement{${escapeTex(referenceTitle)}}{${rendered.length}}{${dense ? '9.2' : '9.8'}}{${dense ? '12.1' : '13.4'}}{${rendered.join('\n')}}{${answer}}{${fallbackTex}}`;
}
