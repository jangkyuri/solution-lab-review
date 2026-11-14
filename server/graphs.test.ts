import { describe, expect, it } from 'vitest';
import { ResultSchema } from '../shared/contracts.ts';
import { prepareGraphs, sampleExpression } from './graphs.ts';
import { sampleMathExpression } from './math-engine.ts';

describe('symbolic graph sampling', () => {
  it('samples a polynomial from its expression', async () => {
    // Given a polynomial, when sampled at five positions, then exact zeros stay zero.
    const points = await sampleExpression('x^2 - 1', -2, 2, 5);
    expect(points).toEqual([{ x: -2, y: 3 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 2, y: 3 }]);
  }, 30_000);

  it('rejects assignments, calls outside the allowlist, and accessors', async () => {
    // Given executable syntax, when submitted, then it is rejected without evaluation.
    for (const expression of ['a=2', 'import("fs")', 'x.constructor', '[1,2]', 'evaluate("2+2")']) {
      await expect(sampleExpression(expression, -1, 1)).rejects.toThrow();
    }
  }, 60_000);

  it('splits a pole that is not on the regular sampling grid', async () => {
    // Given an off-grid pole, when sampled, then no polyline crosses it.
    const result = await sampleMathExpression('1/(x-0.123)', -1, 1, 'x', 40);
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((segment) => segment.every((point) => point.x < 0.123)
      || segment.every((point) => point.x > 0.123))).toBe(true);
  }, 30_000);

  it('does not turn an invalid graph into a verified plot', async () => {
    // Given reversed bounds, when preparing a result, then the graph is omitted with a warning.
    const input = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{ number: '1', problemText: '', firstDecision: '', variables: [], observedOrder: [], answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] }, steps: [{ title: '', explanation: '', latex: '', originalStep: '', evidence: '', graph: { title: 'bad', xMin: 0, xMax: 0, yMin: -1, yMax: 1, xLabel: 'x', yLabel: 'y', points: [], verticals: [], explanation: '', curves: [] } }] }] });
    const result = await prepareGraphs(input);
    expect(result.questions[0]?.steps[0]?.graph).toBeNull();
    expect(result.questions[0]?.uncertainties.length).toBe(1);

    const v1 = await prepareGraphs({ ...input, productionVersion: 'hand-solution-v1' });
    expect(v1.questions[0]?.steps[0]?.graph).toBeNull();
    expect(v1.questions[0]?.uncertainties).toEqual([]);
    expect(v1.limitations[0]).toContain('그래프를 표시하지 못했습니다.');
  });

  it('keeps a qualitative sketch separate from symbolic reconstruction', async () => {
    // Given a source schematic, when prepared, then no precise function is invented for it.
    const input = ResultSchema.parse({ summary: '', references: [], limitations: [], questions: [{ number: '1', problemText: '', firstDecision: '', variables: [], observedOrder: [], answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] }, steps: [{ title: '', explanation: '', latex: '', originalStep: '', evidence: '', graph: { title: '개형', xMin: -1, xMax: 1, yMin: -1, yMax: 1, xLabel: 'x', yLabel: 'y', points: [], verticals: [], explanation: '', curves: [], qualitative: true } }] }] });
    const result = await prepareGraphs(input);
    expect(result.questions[0]?.steps[0]?.graph?.qualitative).toBe(true);
    expect(result.questions[0]?.uncertainties).toEqual([]);
  });
});
