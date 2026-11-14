import { describe, expect, it } from 'vitest';
import { escapeTex, formatInlineTex, mathBlock, safeMath, pdfFilename } from './pdf-safety.ts';

describe('PDF content boundary', () => {
  it('escapes executable text when a note contains TeX commands', () => {
    // Given: teacher notes are plain text, not executable TeX.
    const note = String.raw`한글 50% & 값_1 \input{secret}`;
    // When: the note enters the typesetting boundary.
    const result = escapeTex(note);
    // Then: TeX metacharacters are encoded as visible text.
    expect(result).toBe(String.raw`한글 50\% \& 값\_1 \textbackslash{}input\{secret\}`);
  });

  it('accepts ordinary math while rejecting file or macro execution', () => {
    // Given: math input and commands that could access the TeX process.
    const allowed = String.raw`\frac{1}{2}+\sqrt{x^2}`;
    const blocked = [String.raw`\input{secret}`, String.raw`\write18{calc}`, String.raw`\def\x{3}`, String.raw`\csname input\endcsname`, '^^5cinput{secret}'];
    // When: math commands are checked.
    const accepted = safeMath(allowed);
    const rejected = blocked.map(safeMath);
    // Then: only a bounded mathematical language reaches XeLaTeX.
    expect(accepted).toBe(allowed);
    expect(safeMath(String.raw`f^{\prime}(x)`)).toBe(String.raw`f^{\prime}(x)`);
    expect(rejected).toEqual([null, null, null, null, null]);
  });

  it('keeps supported inline math and renders unsafe inline content literally', () => {
    // Given: one valid formula and one attempted file command.
    const input = String.raw`값은 \(x^2\)이고 \(\input{hidden}\)는 메모다.`;
    // When: mixed prose is converted.
    const result = formatInlineTex(input);
    // Then: the valid expression is math and unsafe commands remain escaped.
    expect(result).toContain(String.raw`\(x^2\)`);
    expect(result).toContain(String.raw`\textbackslash{}input\{hidden\}`);
    expect(result).not.toContain(String.raw`\(\input{hidden}\)`);
  });

  it('preserves an inline integral with an explicit display style', () => {
    const formula = String.raw`\displaystyle \int_1^x tf(t)\,dt+\int_{-1}^x tg(t)\,dt=3x^4+8x^3-3x^2`;
    const problem = `등식 \\(${formula}\\)이 성립한다.`;
    expect(safeMath(formula)).toBe(formula);
    expect(formatInlineTex(problem)).toBe(problem);
  });

  it('creates a bounded filename without path traversal', () => {
    // Given: an uploaded title could contain paths and reserved characters.
    const title = '../../미적1:실전?';
    // When: the output name is generated.
    const name = pdfFilename(title, 1);
    // Then: it is a single descriptive PDF basename.
    expect(name).not.toMatch(/[\\/:?]/u);
    expect(name).toMatch(/_v01_02정답해설\.pdf$/u);
  });

  it('keeps a Korean conclusion outside math mode', () => {
    // Given: a conclusion may be prose, not a formula.
    const conclusion = '정답은 4이다.';
    // When: the answer is typeset.
    const result = mathBlock(conclusion);
    // Then: ordinary Korean uses the body font.
    expect(result).toBe(conclusion);
  });

  it('normalizes multiline mathematical whitespace', () => {
    // Given: generated aligned math commonly includes newlines.
    const formula = '\\begin{aligned}x&=1\\\\\n&=1\\end{aligned}';
    // When: its commands are checked.
    const result = safeMath(formula);
    // Then: line formatting does not force a literal fallback.
    expect(result).toBe(formula.replace('\n', ' '));
  });

  it('rejects a dangling backslash', () => {
    // Given: an incomplete escape could consume the closing math delimiter.
    const formula = 'x+\\';
    // When: it crosses the TeX boundary.
    const result = safeMath(formula);
    // Then: the invalid formula stays literal.
    expect(result).toBeNull();
  });
  it('accepts long logical arrows in generated math without allowing TeX execution', () => {
    // Given: generated deductions use standard long implication and equivalence arrows.
    const arrows = ['Longrightarrow', 'Longleftarrow', 'Longleftrightarrow'];
    const formulas = arrows.map((command) => `x=1\\${command} x^2=1`);
    const doubled = arrows.map((command) => `x=1\\\\${command} x^2=1`);
    const blocked = [String.raw`\input{secret}`, String.raw`\\input{secret}`, String.raw`\newcommand{\x}{1}`];
    // When: the math crosses the shared safety boundary.
    const accepted = formulas.map(safeMath);
    const normalized = doubled.map(safeMath);
    const rejected = blocked.map(safeMath);
    // Then: both generated encodings reach math mode and executable TeX stays blocked.
    expect(accepted).toEqual(formulas);
    expect(normalized).toEqual(formulas);
    expect(rejected).toEqual([null, null, null]);
  });
  it('accepts standard logical arrow aliases in generated deductions', () => {
    // Given: equivalent AMS aliases may appear in generated math.
    const aliases = ['iff', 'implies', 'impliedby'];
    const formulas = aliases.map((command) => `x=1\\${command} x^2=1`);
    const doubled = aliases.map((command) => `x=1\\\\${command} x^2=1`);
    const blocked = [String.raw`\input{secret}`, String.raw`\\input{secret}`, String.raw`\csname input\endcsname`];
    // When: both representations cross the shared math boundary.
    const accepted = formulas.map(safeMath);
    const normalized = doubled.map(safeMath);
    const rejected = blocked.map(safeMath);
    // Then: aliases are safe math while executable commands remain rejected.
    expect(accepted).toEqual(formulas);
    expect(normalized).toEqual(formulas);
    expect(rejected).toEqual([null, null, null]);
  });
  it('accepts bounded math arrays with generated literal newline tokens', () => {
    // Given: a generated comparison table may use an ordinary math array.
    const formula = String.raw`\begin{array}{c|cc}\n\text{절댓값 안의 식의 극솟값} & \text{음수} & \text{양수} \\\n\hline\n a=0\text{에서 교점 수} & 3 & 1 \\\n\text{가장 높은 극댓값 높이에서 교점 수} & 3 & 3\n\end{array}`;
    const expected = String.raw`\begin{array}{c|cc} \text{절댓값 안의 식의 극솟값} & \text{음수} & \text{양수} \\ \hline  a=0\text{에서 교점 수} & 3 & 1 \\ \text{가장 높은 극댓값 높이에서 교점 수} & 3 & 3 \end{array}`;
    // When: the generated array crosses the math boundary.
    const result = safeMath(formula);
    // Then: formatting artifacts become spaces, with table row breaks intact.
    expect(result).toBe(expected);
  });

  it('preserves n-prefixed commands and row breaks when normalizing literal newlines', () => {
    // Given: legitimate commands beginning with n and a row followed by variable n.
    const formula = String.raw`\neq 0+\nu+\begin{aligned}x&=1\\ n & =2\end{aligned}`;
    // When: the math boundary normalizes formatting.
    const result = safeMath(formula);
    // Then: every mathematical token and row break remains unchanged.
    expect(result).toBe(formula);
  });

  it('rejects nonstandard or executable math array preambles and environments', () => {
    // Given: the permitted array language has only a bounded simple column specification.
    const blocked = [
      String.raw`\begin{array}{p{2cm}}1\end{array}`,
      String.raw`\begin{array}{>{\input{secret}}c}1\end{array}`,
      String.raw`\begin{array}{*{2}{c}}1\end{array}`,
      String.raw`\begin{array}{}1\end{array}`,
      String.raw`\begin{array}{ccccccccccccc}1\end{array}`,
      String.raw`\begin{array}{||||||||||||||||||||||||||||||||c}1\end{array}`,
      String.raw`\begin{array}{c}\input{secret}\end{array}`,
      String.raw`\begin{document}x\end{document}`,
      String.raw`\begin{array}{c}1\end{document}`,
    ];
    // When: untrusted array forms cross the boundary.
    const rejected = blocked.map(safeMath);
    // Then: unsupported layouts and executable content never enter TeX.
    expect(rejected).toEqual(blocked.map(() => null));
  });
  it('repairs doubled generated math commands without consuming aligned row breaks', () => {
    const doubled = String.raw`g\\left(\\frac{2}{3}\\right)=\\frac{89}{27},\\quad g(2)=5`;
    const corrected = String.raw`g\left(\frac{2}{3}\right)=\frac{89}{27},\quad g(2)=5`;
    expect(safeMath(doubled)).toBe(corrected);
    const aligned = String.raw`\begin{aligned}x&=1\\\frac{x}{2}&=\frac{1}{2}\end{aligned}`;
    expect(safeMath(aligned)).toBe(aligned);
    expect(safeMath(String.raw`\\input{x}`)).toBeNull();
  });
});
