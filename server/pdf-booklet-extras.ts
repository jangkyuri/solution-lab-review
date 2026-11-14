import type { StepBooklet } from '../shared/contracts.ts';
import { formatBookletInlineTex, mathBlock, safeMath } from './pdf-safety.ts';
import { BAEKSIN_EMPHASIS_PREAMBLE } from './pdf-booklet-emphasis.ts';
import { formatBookletTableCell } from './pdf-booklet-table.ts';
import { BAEKSIN_MATH_PREAMBLE, isCompactKeyMath, keyBookletMath, measuredBookletMath } from './pdf-booklet-math.ts';

export const BAEKSIN_EXTRAS_PREAMBLE = String.raw`
${BAEKSIN_EMPHASIS_PREAMBLE}
${BAEKSIN_MATH_PREAMBLE}
\definecolor{baeksinolive}{HTML}{788C43}
\newcommand{\baeksinreftag}{%
  \begin{tikzpicture}[x=1bp,y=1bp,baseline=(refword.base)]
    \path[draw=baeksinolive,line width=.55bp,fill=white,rounded corners=0bp]
      (0,-3)--(20,-3)--(24,2)--(20,7)--(0,7)--cycle;
    \node[inner sep=0bp,text=baeksinolive,
      font=\labeltext\fontsize{7.2bp}{9bp}\selectfont] (refword) at (10,2) {참고};
  \end{tikzpicture}%
}
\newcommand{\baeksinreference}[1]{%
  \par\Needspace{34bp}\vspace{8bp}\noindent
  \begin{tikzpicture}
    \node[draw=rulegray!80,line width=.45bp,rounded corners=4bp,fill=white,
      inner xsep=9bp,inner ysep=7bp,text width=\dimexpr\linewidth-20bp\relax] {%
      \begin{minipage}[t]{25bp}\vspace{0pt}\baeksinreftag\end{minipage}\hspace{10bp}%
      \begin{minipage}[t]{\dimexpr\linewidth-35bp\relax}\vspace{0pt}
        \raggedright\fontsize{8.8bp}{12.8bp}\selectfont #1\par%
      \end{minipage}};
  \end{tikzpicture}\par
}
\newcommand{\baeksinterm}[3]{%
  \underbrace{{\color{#1}#2}}_{\text{\parbox[t]{82bp}{\centering\labeltext\color{#1}\fontsize{8.2bp}{11bp}\selectfont #3}}}%
}
\newsavebox{\baeksinevidencebox}
\newsavebox{\baeksinevidencecontent}
\newcommand{\baeksinevidence}[1]{%
  \sbox{\baeksinevidencecontent}{\begin{minipage}[t]{\linewidth}\vspace{0pt}#1\par\end{minipage}}%
  \sbox{\baeksinevidencebox}{%
    \ifx\baeksinpendingmarker\empty\else
      \makebox[0pt][r]{\baeksinmarkertop{\baeksinpendingmarker}\hspace{\baeksinmarkergap}}%
    \fi
    \usebox{\baeksinevidencecontent}}%
  \ifdim\dimexpr\ht\baeksinevidencebox+\dp\baeksinevidencebox\relax>.85\textheight
    \baeksinstart #1\par%
  \else
    \ifhmode\usebox{\baeksinevidencebox}\par%
    \else\Needspace{\dimexpr\ht\baeksinevidencebox+\dp\baeksinevidencebox+4bp\relax}\noindent\usebox{\baeksinevidencebox}\par\fi%
    \let\baeksinpendingmarker\empty
  \fi
}
\newsavebox{\baeksincompactbox}
\newcommand{\baeksincompactstep}[1]{%
  \sbox{\baeksincompactbox}{\begin{minipage}[t]{\linewidth}\vspace{0pt}%
    \let\baeksinpendingmarker\empty #1\par\end{minipage}}%
  \ifdim\dimexpr\ht\baeksincompactbox+\dp\baeksincompactbox\relax>.35\textheight
    \baeksinstart #1\par%
  \else
    \baeksinevidence{\usebox{\baeksincompactbox}}%
  \fi
}
\newcommand{\baeksinzoom}[3]{%
  \par\Needspace{158bp}\noindent
  \begin{minipage}[c]{.52\linewidth}\centering #1\end{minipage}\hfill
  {\color{accent}\rule{.044\linewidth}{.5bp}}\hfill
  \begin{minipage}[c]{.38\linewidth}\centering #2\end{minipage}\par
  {\baeksinlabel{#3}}\par
}
`;

export function displayBookletMath(value: string, notes: StepBooklet['termNotes'], role: 'normal' | 'key' = 'normal', layout: 'standard' | 'paired' | 'left' = 'standard', prefix = ''): string {
  const latex = safeMath(value);
  if (!latex) return prefix + mathBlock(value);
  const found = (notes ?? []).flatMap((note) => {
    const term = safeMath(note.term);
    if (!term) return [];
    const start = latex.indexOf(term);
    if (start < 0 || start !== latex.lastIndexOf(term)) return [];
    const before = latex[start - 1] ?? '';
    const after = latex[start + term.length] ?? '';
    const first = term[0] ?? '';
    const last = term.at(-1) ?? '';
    const word = /[\p{L}\p{N}.]/u;
    if (/[\^_\\]/u.test(before) || (word.test(before) && word.test(first))
      || (word.test(last) && word.test(after))) return [];
    return [{ ...note, term, start }];
  }).sort((first, second) => first.start - second.start);
  let end = 0;
  const math: string[] = [];
  for (const note of found) {
    if (note.start < end) continue;
    math.push(latex.slice(end, note.start));
    math.push(String.raw`\baeksinterm{${note.color === 'brown' ? 'warm' : 'accent'}}{${note.term}}{${formatBookletInlineTex(note.note)}}`);
    end = note.start + note.term.length;
  }
  const expression = math.join('') + latex.slice(end);
  if (layout === 'paired') return String.raw`\solutionpairmath{${expression}}`;
  return layout === 'standard' && role === 'key' && isCompactKeyMath(latex) ? String.raw`\baeksinkeymath{${keyBookletMath(expression)}}`
    : measuredBookletMath(expression, layout === 'left', prefix);
}

export function isLeadingSourceDefinition(value: string, problem: string): boolean {
  const definition = safeMath(value)?.match(/^([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=/u);
  if (!definition) return false;
  return Array.from(problem.matchAll(/\b([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=/gu))
    .some(source => source[1] === definition[1] && source[2] === definition[2]);
}

export function bookletTable(table: NonNullable<StepBooklet['table']>, breakable = false): string {
  const columns = table[0]?.length ?? 0;
  if (columns < 2 || columns > 3 || table.some((row) => row.length !== columns)) return '';
  const column = String.raw`>{\raggedright\arraybackslash}p{${(.90 / columns).toFixed(2)}\linewidth}`;
  const rows = table.map((row, index) => {
    const cells = row.map(formatBookletTableCell);
    const fractional = cells.some((cell) => /\\(?:d?frac|tfrac)(?![A-Za-z])/u.test(cell));
    const clearance = fractional ? String.raw`\rule[-9bp]{0pt}{26bp}` : '';
    const separator = !breakable && index < table.length - 1 ? String.raw` \\${fractional ? '[14bp]' : ''}` : '';
    return clearance + cells.join(' & ') + separator;
  });
  if (breakable) return String.raw`\begingroup\setlength{\tabcolsep}{4bp}\renewcommand{\arraystretch}{1.20}` + rows.map((row, index) =>
    String.raw`\par\noindent\begin{tabular}{@{}${column.repeat(columns)}@{}}${row}\end{tabular}\par${index === 0 ? '\\nobreak' : ''}`).join('\n') + String.raw`\endgroup`;
  return String.raw`\begin{center}\begingroup
\setlength{\tabcolsep}{5bp}\renewcommand{\arraystretch}{1.20}
\begin{tabular}{@{}${column.repeat(columns)}@{}}
${rows.join('\n')}
\end{tabular}
\endgroup\end{center}`;
}
