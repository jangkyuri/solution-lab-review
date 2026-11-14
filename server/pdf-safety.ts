const mathCommands = new Set([
  'frac', 'dfrac', 'tfrac', 'displaystyle', 'sqrt', 'left', 'right', 'middle', 'big', 'Big', 'bigl', 'bigr',
  'lim', 'limits', 'to', 'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow',
  'Longrightarrow', 'Longleftarrow', 'Longleftrightarrow',
  'iff', 'implies', 'impliedby', 'hline',
  'infty', 'cdot', 'cdots', 'ldots', 'vdots', 'ddots', 'times', 'div', 'pm', 'mp', 'circ', 'prime',
  'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'equiv', 'approx', 'sim', 'simeq',
  'sum', 'prod', 'int', 'iint', 'oint', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'log', 'ln', 'exp', 'min', 'max', 'sup', 'inf', 'det', 'gcd', 'lvert', 'rvert', 'lVert', 'rVert',
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'theta', 'lambda', 'mu', 'nu', 'pi',
  'rho', 'sigma', 'tau', 'phi', 'varphi', 'omega', 'Gamma', 'Delta', 'Theta', 'Pi', 'Sigma', 'Omega',
  'mid', 'in', 'notin', 'subset', 'subseteq', 'cup', 'cap', 'emptyset', 'forall', 'exists', 'land', 'lor',
  'mathbb', 'mathbf', 'mathrm', 'mathit', 'mathcal', 'operatorname', 'text', 'underbrace', 'overbrace',
  'underline', 'overline', 'widehat', 'hat', 'vec', 'bar', 'boxed', 'quad', 'qquad', 'substack',
]);
const environments = new Set(['aligned', 'gathered', 'cases', 'matrix', 'pmatrix', 'bmatrix']);
const escaped = new Map([
  ['\\', '\\textbackslash{}'], ['{', '\\{'], ['}', '\\}'], ['$', '\\$'],
  ['&', '\\&'], ['%', '\\%'], ['#', '\\#'], ['_', '\\_'],
  ['^', '\\textasciicircum{}'], ['~', '\\textasciitilde{}'],
  ['−', '\\ensuremath{-}'],
]);

export function escapeTex(value: string): string {
  return [...value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')]
    .map((character) => escaped.get(character) ?? character).join('');
}

function mathEnvironmentDepth(value: string): number | null {
  const stack: string[] = [];
  for (const marker of value.matchAll(/\\(begin|end)\{([^{}]+)\}/gu)) {
    const name = marker[2] ?? '';
    if (!environments.has(name) && name !== 'array') return null;
    if (marker[1] === 'begin') stack.push(name);
    else if (stack.pop() !== name) return null;
  }
  return stack.length;
}

export function safeMath(value: string): string | null {
  let valid = true;
  const trimmed = value.replace(/(\\+)n(?=\\+[A-Za-z]|[ \t\r\n]|$)/gu, (whole, slashes: string) =>
    slashes.length % 2 === 1 ? `${slashes.slice(1)} ` : whole)
    .replace(/\r\n|\r|\n|\t/gu, ' ')
    .replace(/(?<!\\)\\\\([A-Za-z]+)/gu, (whole, command: string, offset: number, input: string) => {
      if (!mathCommands.has(command) && command !== 'begin' && command !== 'end') {
        // A row separator can be followed immediately by a short variable name.
        if (command.length <= 2 && (mathEnvironmentDepth(input.slice(0, offset)) ?? 0) > 0) return whole;
        valid = false;
        return whole;
      }
      return `\\${command}`;
    }).trim();
  if (!valid || !trimmed || trimmed.length > 8000 || /[\u0000-\u001f%#$]|\^\^/u.test(trimmed)) return null;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '\\') {
      if (trimmed[index + 1] === undefined) return null;
      index += 1;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0 || depth > 24) return null;
  }
  if (depth !== 0 || mathEnvironmentDepth(trimmed) !== 0) return null;
  const withoutArrays = trimmed.replace(/\\begin\{array\}\s*\{([^{}]*)\}/gu, (_whole, preamble: string) => {
    const columns = preamble.replace(/\s/gu, '');
    const columnCount = columns.replace(/\|/gu, '').length;
    if (preamble.length > 32 || !/^[clr|]{1,24}$/u.test(columns) || columnCount < 1 || columnCount > 12) valid = false;
    return '';
  });
  const withoutEnvironments = withoutArrays.replace(/\\(begin|end)\{([^}]+)\}/gu, (_whole, kind: string, name: string) => {
    if (name === 'array' && kind === 'end') return '';
    if (!environments.has(name)) valid = false;
    return '';
  });
  const withoutText = withoutEnvironments.replace(/\\text\{[^{}]*\}/gu, '');
  const withoutLabels = withoutText.replace(/\\(?:mathrm|mathbf|mathit|mathcal|mathbb|operatorname)\*?\{[A-Za-z][A-Za-z0-9 ]{0,39}\}/gu, '');
  const bareContent = withoutLabels.replace(/\\[A-Za-z]+/gu, '');
  if (/[\p{Script=Hangul}\p{Script=Han}]/u.test(bareContent) || /[A-Za-z]{3,}/u.test(bareContent)) return null;
  const commands = withoutEnvironments.matchAll(/\\([A-Za-z]+|.)/gu);
  for (const command of commands) {
    const token = command[1] ?? '';
    if (!mathCommands.has(token) && !new Set([',', ';', ':', '!', ' ', '\\', '{', '}', '|']).has(token)) return null;
  }
  return valid ? trimmed : null;
}

function formatDelimitedTex(value: string, readableFractions: boolean): string {
  const pattern = /\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/gu;
  let result = '';
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    result += escapeTex(value.slice(end, start));
    const math = safeMath(match[1] ?? match[2] ?? '');
    result += math === null ? escapeTex(match[0]) : `\\(${readableFractions && /\\frac\b/u.test(math) ? '\\displaystyle ' : ''}${math}\\)`;
    end = start + match[0].length;
  }
  return (result + escapeTex(value.slice(end))).replace(/\r?\n/gu, '\\par\n');
}

export function formatInlineTex(value: string): string {
  return formatDelimitedTex(value, false);
}

export function formatBookletInlineTex(value: string): string {
  return formatDelimitedTex(value, true);
}

export function mathBlock(value: string): string {
  const math = safeMath(value);
  return math === null ? formatInlineTex(value) : `\\[\\displaystyle ${math}\\]`;
}

export function pdfFilename(title: string, version: number): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, ' ').replace(/\.+/gu, ' ').replace(/\s+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 100) || '개인풀이';
  return `${clean}_v${String(version).padStart(2, '0')}_02정답해설.pdf`;
}
