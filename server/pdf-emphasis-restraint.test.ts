import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { renderPdfTex } from './pdf-template.ts';

function fixture(equations: readonly (readonly string[])[]) {
  return JobSchema.parse({ ...jobFixture, mode: 'supplement', status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN,
    result: { summary: '', references: [], limitations: [], questions: equations.map((rows, index) => ({
      number: String(index + 1), problemText: '주어진 조건을 이용하여 값을 구하여라.', firstDecision: '',
      variables: ['x'], observedOrder: [], answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
      steps: rows.map((latex, stepIndex) => ({ id: 'S' + String(stepIndex + 1).padStart(2, '0'), after: [], branch: null,
        title: '', originalStep: '', explanation: '', evidence: '', graph: null, latex,
        booklet: { group: String.fromCharCode(65 + stepIndex), equationRole: 'key' },
      })),
    })) },
  });
}

function body(job: ReturnType<typeof fixture>): string {
  return renderPdfTex(job, [], new Map()).split(String.raw`\begin{document}`)[1] ?? '';
}

describe('restrained equation emphasis', () => {
  it.each([
    String.raw`x^2=1,\quad x=1`,
    String.raw`\begin{aligned}x^2&=1\\x&=1\end{aligned}`,
    String.raw`f(x)=\begin{cases}x^2&x<0\\x&x\ge0\end{cases}`,
  ])('keeps a marked calculation block at normal size without changing its content (%s)', latex => {
    // Given an existing result whose key marker covers several calculations or rows.
    const job = fixture([[latex]]);
    const original = structuredClone(job);
    // When the booklet is rendered without regenerating its mathematical content.
    const tex = body(job);
    // Then the block is present but is not promoted into an enlarged equation.
    expect(tex).not.toContain(String.raw`\baeksinkeymath{`);
    expect(tex).toContain('x');
    expect(job).toStrictEqual(original);
  });

  it('enlarges at most one compact equation per question even when a saved result marks more', () => {
    // Given two questions with two short key-marked relations each.
    const job = fixture([['x=1', 'x^2=1'], ['x=2', 'x^2=4']]);
    const original = structuredClone(job);
    // When the saved result is rendered.
    const tex = body(job);
    // Then each question has at most one enlargement and all four equations remain.
    expect(tex.match(/\\baeksinkeymath\{/gu) ?? []).toHaveLength(2);
    for (const value of ['x=1', 'x^2=1', 'x=2', 'x^2=4']) expect(tex).toContain(value);
    expect(job).toStrictEqual(original);
  });

  it('does not spend the compact-equation emphasis on a preceding long derivation', () => {
    const job = fixture([[String.raw`x^2=1,\quad x=1`, 'x>0']]);
    const original = structuredClone(job);
    const tex = body(job);
    expect(tex.match(/\\baeksinkeymath\{/gu) ?? []).toHaveLength(1);
    expect(tex).toContain(String.raw`\baeksinkeychunk{x>0}`);
    expect(job).toStrictEqual(original);
  });
});
