import { describe, expect, it } from 'vitest';
import { GraphSchema } from '../shared/contracts.ts';
import { studentFacingGraph } from './student-language.ts';

describe('student graph line labels', () => {
  it.each([
    { height: 1e-7, expected: String.raw`직선 \(y=1\times 10^{-7}\)` },
    { height: 1e21, expected: String.raw`직선 \(y=1\times 10^{21}\)` },
  ])('uses mathematical scientific notation for the line at $height', ({ height, expected }) => {
    // Given: a horizontal line has a height whose JavaScript string uses e notation.
    const graph = GraphSchema.parse({
      title: '', xMin: -1, xMax: 1, yMin: -1, yMax: height + 1,
      xLabel: 'x', yLabel: 'y', curves: [], points: [], verticals: [], explanation: '',
      horizontals: [{ y: height, label: '수평선' }],
    });

    // When: the student-facing label is prepared.
    const result = studentFacingGraph(graph);

    // Then: the visible formula is valid math and the geometric height stays exact.
    expect(result.horizontals[0]).toEqual({ y: height, label: expected });
  });
});
