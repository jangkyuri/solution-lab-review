import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeMath } from './pdf-safety.ts';
import { generatedFixture, jobFixture, readingFixture } from './generation-fixtures.ts';
import { generationQualityIssues } from './generation-quality.ts';
import { compilePdf } from './pdf-runtime.ts';

const formulas = [
  String.raw`f(x)=\begin{cases}x+1&(x<0)\\x-1&(0\le x<1)\\0&(1\le x\le3)\\-x+4&(x>3)\end{cases}`,
  String.raw`g(x)=\begin{cases}f(x)&(f(x)\le x)\\x&(f(x)>x)\end{cases}`,
  String.raw`\begin{aligned}x&=1\\y&=2\\n&=3\\\frac{x}{2}&=1\end{aligned}`,
  String.raw`\begin{aligned}x&=\begin{cases}x&x<0\\f(x)&x\ge0\end{cases}\\y&=2\end{aligned}`,
];

describe('math row separators followed by variables', () => {
  it.each(formulas)('preserves a valid alignment expression %s', (formula) => {
    // Given: standard TeX permits a row separator directly before a variable.
    // When: math crosses the shared typesetting safety boundary.
    const checked = safeMath(formula);
    // Then: row separators and the mathematical expression remain unchanged.
    expect(checked).toBe(formula);
  });

  it('rejects executable or unknown doubled commands outside mathematical rows', () => {
    // Given: unsupported commands must not gain access through row normalization.
    const blocked = [String.raw`\\x`, String.raw`\\input{x}`, String.raw`\input{x}`,
      String.raw`\begin{cases}x&x<0\\input{x}&x>0\end{cases}`,
      String.raw`\begin{cases}x&x<0\\\write18{x}&x>0\end{cases}`,
      String.raw`\begin{cases}x&x<0\\x&x>0\end{aligned}`,
      String.raw`\begin{cases}x&x<0\\x&x>0`,
      String.raw`\begin{document}x\\x\end{document}`];
    // When: untrusted formulas cross the same boundary.
    const checked = blocked.map(safeMath);
    // Then: no unsupported or executable form is admitted.
    expect(checked).toEqual(blocked.map(() => null));
  });

  it('accepts piecewise source problem text without requesting an impossible source correction', () => {
    // Given: the source and untouched generated statement contain legitimate cases.
    const reading = structuredClone(readingFixture);
    const generated = generatedFixture();
    const source = reading.questions[0];
    const question = generated.questions[0];
    if (!source || !question) throw new Error('Missing fixture question');
    source.problemText = `\\(${formulas[1]}\\)`;
    question.problemText = source.problemText;
    // When: the generated question is reviewed against immutable source text.
    const issues = generationQualityIssues({ ...jobFixture, mode: 'supplement' }, reading, generated);
    // Then: valid row syntax does not block the result.
    expect(issues).toEqual([]);
  });

  it('compiles accepted piecewise source text in a real TeX pass', async () => {
    // Given: the actual source cases use unspaced row separators.
    const stage = await mkdtemp(path.join(tmpdir(), 'math-rowbreak-'));
    try {
      await mkdir(path.join(stage, 'build'));
      const checked = formulas.slice(0, 2).map(safeMath);
      if (checked.some((math) => math === null)) throw new Error('Valid source was rejected');
      await writeFile(path.join(stage, 'main.tex'), String.raw`\documentclass{article}\usepackage{amsmath}\begin{document}`
        + checked.map((math) => String.raw`\[` + math + String.raw`\]`).join('\n') + String.raw`\end{document}`);
      // When: the ordinary XeLaTeX toolchain compiles the expressions.
      const count = await compilePdf(stage);
      // Then: a complete PDF is produced without the typesetter warning gate failing.
      expect(count).toBe(1);
      expect((await readFile(path.join(stage, 'build', 'main.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
});
