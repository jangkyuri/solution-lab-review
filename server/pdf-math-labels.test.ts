import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeMath } from './pdf-safety.ts';
import { generatedFixture, jobFixture, readingFixture } from './generation-fixtures.ts';
import { generationQualityIssues } from './generation-quality.ts';
import { compilePdf } from './pdf-runtime.ts';

const condition = String.raw`\{k\mid k\text{는 함수 }f(x)\text{의 극값이다.}\}`;
const triangle = String.raw`\mathrm{ABC}`;

describe('source set conditions and mathematical labels', () => {
  it.each([condition, triangle, String.raw`\mathbf{PQR}`, String.raw`\operatorname{sgn}(x)`])('accepts standard mathematical notation %s', formula => {
    // Given: these are mathematical symbols or labels, not executable commands.
    // When: unchanged source text crosses the safety boundary.
    // Then: no source correction is requested.
    expect(safeMath(formula)).toBe(formula);
  });

  it('keeps unsupported words and executable commands blocked', () => {
    // Given: a permitted font wrapper must not hide an executable command.
    const invalid = [String.raw`ABC`, String.raw`\mathrm{\input{x}}`, String.raw`\operatorname{\write18{x}}`, String.raw`\unknown{ABC}`];
    // When: untrusted formulas cross the same boundary.
    // Then: the command allowlist still applies to their original contents.
    expect(invalid.map(safeMath)).toEqual(invalid.map(() => null));
  });

  it.each([condition, triangle])('does not reject an immutable problem statement %s', formula => {
    // Given: the source itself contains legitimate set or geometric notation.
    const reading = structuredClone(readingFixture);
    const generated = generatedFixture();
    const source = reading.questions[0];
    if (!source) throw new Error('Missing source fixture');
    source.problemText = '\\(' + formula + '\\)';
    // When: the supplement quality gate checks the source problem.
    // Then: it does not ask the writer to alter immutable source text.
    expect(generationQualityIssues({ ...jobFixture, mode: 'supplement' }, reading, generated)).toEqual([]);
  });

  it('typesets the accepted source notation in real XeLaTeX', async () => {
    // Given: the exact set condition and triangle label from a real new input.
    const stage = await mkdtemp(path.join(tmpdir(), 'math-labels-'));
    try {
      await mkdir(path.join(stage, 'build'));
      const checked = [condition, triangle].map(safeMath);
      if (checked.some(math => math === null)) throw new Error('Valid source was rejected');
      await writeFile(path.join(stage, 'main.tex'), String.raw`\documentclass{article}\usepackage{fontspec}\setmainfont{Malgun Gothic}\usepackage{amsmath}\begin{document}`
        + checked.map(math => '\\[' + math + '\\]').join('\n') + String.raw`\end{document}`);
      // When: the production TeX toolchain compiles it.
      // Then: no unsupported glyph or overflow is hidden by accepting the syntax.
      expect(await compilePdf(stage)).toBe(1);
      expect((await readFile(path.join(stage, 'build', 'main.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
});
