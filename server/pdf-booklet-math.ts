const leadingSpacing = /^(?:\s|\\(?:quad|qquad)\b|\\[,;:! ])*/u;
const trailingClauseSpacing = /(?:\s|\\(?:quad|qquad)\b|\\[,;:! ])*$/u;
const logicalLinks = new Set(['Longleftrightarrow', 'Longrightarrow', 'Leftrightarrow', 'Rightarrow', 'iff', 'implies']);
const emptyClauseTokens = /\s|\\[,;:! ]|\\(?:quad|qquad|Longleftrightarrow|Longrightarrow|Leftrightarrow|Rightarrow|iff|implies)\b/gu;
const unaryMathArguments = new Set(['sqrt', 'mathbb', 'mathbf', 'mathrm', 'mathit', 'mathcal', 'operatorname', 'text',
  'underbrace', 'overbrace', 'underline', 'overline', 'widehat', 'hat', 'vec', 'bar', 'boxed', 'substack']);
const closing = new Map([[')', '('], [']', '['], ['}', '{'], ['\\}', '\\{'], ['rvert', 'lvert'], ['rVert', 'lVert']]);

function mathArgumentEnd(value: string, start: number, opening = '{', closing = '}'): number | null {
  let index = start;
  while (/\s/u.test(value[index] ?? '') && index < value.length) index += 1;
  if (index >= value.length) return null;
  if (value[index] !== opening) {
    return value[index] === '\\' ? index + (/^\\(?:[A-Za-z]+|[\s\S])/u.exec(value.slice(index))?.[0].length ?? 1) : index + 1;
  }
  let depth = 1;
  index += 1;
  while (index < value.length) {
    if (value[index] === '\\') index += /^\\(?:[A-Za-z]+|[\s\S])/u.exec(value.slice(index))?.[0].length ?? 1;
    else {
      if (value[index] === opening) depth += 1;
      if (value[index] === closing) depth -= 1;
      index += 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

export const BAEKSIN_MATH_PREAMBLE = String.raw`
\newsavebox{\baeksinnormalmathbox}
\newcommand{\baeksinmathbreak}[1]{#1}
\newcommand{\baeksinmeasuredmath}[1]{%
  \begingroup\sbox{\baeksinnormalmathbox}{\(\displaystyle #1\)}%
  \ifdim\wd\baeksinnormalmathbox>\linewidth
    \renewcommand{\baeksinmathbreak}[1]{\\}%
    \[\begin{gathered}#1\end{gathered}\]%
  \else
    \[\usebox{\baeksinnormalmathbox}\]%
  \fi\endgroup%
}
\newcommand{\baeksinleftmath}[2][]{%
  \par\noindent\begingroup\sbox{\baeksinnormalmathbox}{#1\(\displaystyle #2\)}%
  \ifdim\wd\baeksinnormalmathbox>\linewidth
    \renewcommand{\baeksinmathbreak}[1]{\\}%
    #1\(\displaystyle\begin{aligned}[t]#2\end{aligned}\)%
  \else\usebox{\baeksinnormalmathbox}\fi\par\endgroup%
}
`;

export function splitBookletMath(value: string): readonly string[] {
  const delimiters: string[] = [];
  const environments: string[] = [];
  const cuts: number[] = [];
  let leftDepth = 0;
  let protectedArgumentEnd = 0;
  let index = 0;
  while (index < value.length) {
    const character = value[index] ?? '';
    if (character === '\\') {
      const token = /^\\([A-Za-z]+|[\s\S])/u.exec(value.slice(index));
      if (!token) return [value];
      const command = token[1] ?? '';
      if (!delimiters.length && !environments.length && leftDepth === 0 && (command === 'qquad' || logicalLinks.has(command))) {
        const start = cuts.at(-1) ?? 0;
        const prefix = value.slice(start, index);
        const cut = Math.max(protectedArgumentEnd, index - (trailingClauseSpacing.exec(prefix)?.[0].length ?? 0));
        const complete = value.slice(start, cut);
        if (complete.replace(emptyClauseTokens, '').trim()) {
          cuts.push(cut);
        }
      }
      index += token[0].length;
      const argumentsCount = /^(?:frac|dfrac|tfrac)$/u.test(command) ? 2 : unaryMathArguments.has(command) ? 1 : 0;
      if (command === 'sqrt' && /^\s*\[/u.test(value.slice(index))) {
        const optionalEnd = mathArgumentEnd(value, index, '[', ']');
        if (optionalEnd === null) return [value];
        index = optionalEnd;
      }
      for (let argument = 0; argument < argumentsCount; argument += 1) {
        const end = mathArgumentEnd(value, index);
        if (end === null) return [value];
        index = end;
      }
      if (argumentsCount > 0) protectedArgumentEnd = index;
      if (command === 'begin' || command === 'end') {
        const environment = /^\s*\{([^{}]+)\}/u.exec(value.slice(index));
        if (!environment) return [value];
        const name = environment[1] ?? '';
        if (command === 'begin') environments.push(name);
        else if (environments.pop() !== name) return [value];
        index += environment[0].length;
      } else if (command === 'left' || command === 'right' || command === 'middle') {
        const delimiter = /^\s*(?:\\(?:[A-Za-z]+|[\s\S])|[^\s])/u.exec(value.slice(index));
        if (!delimiter) return [value];
        if (command === 'left') leftDepth += 1;
        if (command === 'right') leftDepth -= 1;
        if (leftDepth < 0 || (command === 'middle' && leftDepth === 0)) return [value];
        index += delimiter[0].length;
      } else if (command === '{' || command === 'lvert' || command === 'lVert') {
        delimiters.push(command === '{' ? '\\{' : command);
      } else if (command === '}' || command === 'rvert' || command === 'rVert') {
        if (delimiters.pop() !== closing.get(command === '}' ? '\\}' : command)) return [value];
      }
      continue;
    }
    if (character === '^' || character === '_') {
      const end = mathArgumentEnd(value, index + 1);
      if (end === null) return [value];
      index = end;
      protectedArgumentEnd = index;
      continue;
    }
    if ('([{'.includes(character)) delimiters.push(character);
    else if (closing.has(character)) {
      if (delimiters.pop() !== closing.get(character)) return [value];
    } else if (character === '|') {
      if (delimiters.at(-1) === '|') delimiters.pop();
      else if (!/^\s*[_^]/u.test(value.slice(index + 1))) delimiters.push('|');
    } else if ((character === ';' || character === ',') && !delimiters.length && !environments.length && leftDepth === 0) {
      const remainder = value.slice(index + 1);
      const spacing = leadingSpacing.exec(remainder)?.[0] ?? '';
      if ((character === ';' || spacing.length > 0) && remainder.slice(spacing.length).trim()
        && value.slice(cuts.at(-1) ?? 0, index).trim()) cuts.push(index + 1);
    }
    index += 1;
  }
  if (delimiters.length || environments.length || leftDepth !== 0 || !cuts.length) return [value];
  return [...cuts, value.length].map((end, position) => value.slice(cuts[position - 1] ?? 0, end));
}

export function measuredBookletMath(value: string, leftAligned = false, prefix = ''): string {
  const parts = splitBookletMath(value);
  const leftMath = prefix ? String.raw`\baeksinleftmath[${prefix}]` : String.raw`\baeksinleftmath`;
  if (parts.length < 2) return leftAligned ? `${leftMath}{${value}}` : String.raw`\[\displaystyle ${value}\]`;
  const expression = parts.map((part, index) => {
    if (index === 0) return part;
    const spacing = leadingSpacing.exec(part)?.[0] ?? '';
    return String.raw`\baeksinmathbreak{${spacing}}${part.slice(spacing.length)}`;
  }).join('');
  return leftAligned ? `${leftMath}{${expression}}` : String.raw`\baeksinmeasuredmath{${expression}}`;
}

export function isCompactKeyMath(value: string): boolean {
  return value.trim().length > 0 && !/\\begin\{|\\\\/u.test(value) && splitBookletMath(value).length === 1;
}

export function keyBookletMath(value: string): string {
  return splitBookletMath(value).map((part, index) => {
    const spacing = index === 0 ? '' : leadingSpacing.exec(part)?.[0] ?? '';
    const boundary = index === 0 ? '' : String.raw`\baeksinmathbreak{${spacing}}`;
    return boundary + String.raw`\baeksinkeychunk{${part.slice(spacing.length)}}`;
  }).join('');
}
