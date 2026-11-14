import { formatBookletInlineTex, safeMath } from './pdf-safety.ts';

export const BAEKSIN_EMPHASIS_PREAMBLE = String.raw`
\definecolor{baeksinhighlight}{HTML}{DCE7ED}
\newsavebox{\baeksinmarkedphrase}
\newcommand{\baeksinhighlight}[1]{%
  \begingroup\sbox{\baeksinmarkedphrase}{\bfseries #1}%
  \ifdim\wd\baeksinmarkedphrase>\linewidth
    #1%
  \else
    \leavevmode\rlap{\color{baeksinhighlight}\raisebox{-0.6bp}{\rule{\wd\baeksinmarkedphrase}{4.5bp}}}%
    \usebox{\baeksinmarkedphrase}%
  \fi\endgroup%
}
\newsavebox{\baeksinkeybox}
\newcommand{\baeksinkeychunk}[1]{#1}
\newcommand{\baeksinkeymath}[1]{%
  \par\Needspace{32bp}\vspace{3bp}\begingroup
  \fontsize{13.2bp}{20bp}\selectfont\sbox{\baeksinkeybox}{\(\displaystyle #1\)}%
  \ifdim\wd\baeksinkeybox>\linewidth
    \fontsize{11.2bp}{18.2bp}\selectfont\[\displaystyle #1\]%
  \else
    \noindent\makebox[\linewidth][c]{\usebox{\baeksinkeybox}}\par
  \fi
  \endgroup\vspace{4bp}%
}
`;

export function formatBookletProse(value: string, phrases: readonly string[] = []): string {
  const math = Array.from(value.matchAll(/\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$|\\\[([\s\S]*?)\\\]/gu), match => ({
    start: match.index, end: match.index + match[0].length,
    safe: match[3] === undefined && safeMath(match[1] ?? match[2] ?? '') !== null,
  }));
  const commands = Array.from(value.matchAll(/\\[A-Za-z]+/gu), match => ({
    start: match.index, end: match.index + match[0].length,
  }));
  const candidates = [...new Set(phrases.slice(0, 2))].flatMap(phrase => {
    if (!phrase.trim() || /[\r\n]/u.test(phrase)) return [];
    const start = value.indexOf(phrase);
    if (start < 0 || start !== value.lastIndexOf(phrase)) return [];
    const end = start + phrase.length;
    const overlaps = (span: { readonly start: number; readonly end: number }) => start < span.end && end > span.start;
    if ([...math, ...commands].some(span => overlaps(span) && (start > span.start || end < span.end))
      || math.some(span => overlaps(span) && !span.safe)) return [];
    return [{ start, end }];
  }).sort((first, second) => first.start - second.start || second.end - first.end);
  const parts: string[] = [];
  let end = 0;
  for (const span of candidates) {
    if (span.start < end) continue;
    parts.push(formatBookletInlineTex(value.slice(end, span.start)));
    parts.push(String.raw`\baeksinhighlight{${formatBookletInlineTex(value.slice(span.start, span.end))}}`);
    end = span.end;
  }
  parts.push(formatBookletInlineTex(value.slice(end)));
  return String.raw`\begingroup\raggedright\lineskiplimit=2.5bp\lineskip=3bp ${parts.join('')}\par\endgroup`;
}
