import { describe, expect, it } from 'vitest';
import { normalizeIntegralEvaluation } from './integral-notation.ts';

describe('definite integral endpoint notation', () => {
  it.each([
    [String.raw`\int_{0}^{2}x\,dx=\left.\frac{x^2}{2}\right|_{0}^{2}`, String.raw`\int_{0}^{2}x\,dx=\left[\frac{x^2}{2}\right]_{0}^{2}`],
    [String.raw`\left.\left|F(x)\right|\right\rvert^{\frac{1}{2}}_{-1}`, String.raw`\left[\left|F(x)\right|\right]^{\frac{1}{2}}_{-1}`],
    [String.raw`\left . F(x) \right\vert _a ^b+\left.G(x)\right|_c^d`, String.raw`\left [ F(x) \right] _a ^b+\left[G(x)\right]_c^d`],
  ])('uses brackets for %s', (source, expected) => {
    expect(normalizeIntegralEvaluation(source)).toBe(expected);
  });

  it.each([
    String.raw`\int_0^2 |x-1|\,dx`,
    String.raw`\left|x\right|_a^b`,
    String.raw`\left. f'(x)\right|_{x=2}`,
    String.raw`\left. F(x)\right|_{a}`,
    String.raw`\left[F(x)\right]_a^b`,
    String.raw`\(\left. f(x)\) \(\right|_a^b\)`,
  ])('preserves %s', (source) => {
    expect(normalizeIntegralEvaluation(source)).toBe(source);
  });
});
