import { describe, expect, it } from 'vitest';
import { formatInlineTex } from './pdf-safety.ts';
import { formatBookletTableCell } from './pdf-booklet-table.ts';

describe('legacy booklet table cell math', () => {
  it.each([
    ['at^4-4at^4', '\\(at^4-4at^4\\)'],
    ['-3at^4', '\\(-3at^4\\)'],
    ['dt-dt', '\\(dt-dt\\)'],
    ['e', '\\(e\\)'],
    ['89/27', '\\(\\displaystyle \\frac{89}{27}\\)'],
    ['-2/3', '\\(\\displaystyle \\frac{-2}{3}\\)'],
    ['x^2/3', '\\(x^2/3\\)'],
  ])('typesets a safe raw math cell without changing its expression (%s)', (input, expected) => {
    expect(formatBookletTableCell(input)).toBe(expected);
  });

  it.each([
    ["f(t)-tf'(t)의 계산", "\\(f(t)-tf'(t)\\)의 계산"],
    ['내부의 극댓값 후보 t=2/3', '내부의 극댓값 후보 \\(\\displaystyle t=\\frac{2}{3}\\)'],
    ['왼쪽 끝 t=0', '왼쪽 끝 \\(t=0\\)'],
  ])('separates mixed Korean and mathematical runs (%s)', (input, expected) => {
    expect(formatBookletTableCell(input)).toBe(expected);
  });

  it.each(['차수별 결과', 'ordinary English words', 'if', 'Notes & examples', '\\(t=2/3\\)의 값', '$89/27$'])('preserves ordinary text and existing inline math (%s)', (input) => {
    expect(formatBookletTableCell(input)).toBe(formatInlineTex(input));
  });

  it.each(['\\input{secret}', '\\href{https://example.com}{x}', '\\unknown{x}', '\\(\\input{secret}\\)', '\u001b\\input{secret}'])('never activates an unsafe command or control (%s)', (input) => {
    const output = formatBookletTableCell(input);
    expect(output).toContain('\\textbackslash{}');
    expect(output).not.toMatch(/\\(?:input|href|unknown)\b/u);
    expect(output).not.toContain('\u001b');
  });
});
