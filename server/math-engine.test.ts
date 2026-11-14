import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GraphSchema } from '../shared/contracts.ts';
import { checkMath, renderGraph } from './math-engine.ts';

describe('the real symbolic process bridge', () => {
  it('differentiates using the supplied original variable', async () => {
    // Given a polynomial in t, when differentiated, then its result uses t.
    const result = await checkMath({ operation: 'derivative', expression: 't^3', variable: 't' });
    expect(result.result).toBe('3*t**2');
    expect(result.status).toBe('computed');
  }, 30_000);

  it('does not verify an equality with a changed real domain', async () => {
    // Given a removable hole, when compared globally, then equivalence is undetermined.
    const result = await checkMath({ operation: 'equivalence', expression: 'x/x', comparison: '1', variable: 'x' });
    expect(result.status).toBe('undetermined');
  }, 30_000);

  it('rejects executable text at the Python boundary', async () => {
    // Given an attribute call, when checked, then no computation is accepted.
    await expect(checkMath({ operation: 'simplify', expression: '__import__("os").getcwd()', variable: 'x' })).rejects.toThrow();
  }, 30_000);

  it('renders an actual Korean-labeled PDF and SVG from finite graph data', async () => {
    // Given validated graph data, when exported, then both vector file formats are real.
    const testRoot = fileURLToPath(new URL('../data/math-qa/', import.meta.url));
    await mkdir(testRoot, { recursive: true });
    const folder = await mkdtemp(join(testRoot, 'solution-math-'));
    try {
      const graph = GraphSchema.parse({ title: '함숫값과 높이', xMin: -2, xMax: 2, yMin: -2, yMax: 3, xLabel: 'x', yLabel: 'y', explanation: '', points: [{ x: 1, y: 1, label: '(1, 1)', open: true }], verticals: [{ x: 1, label: '경계' }], curves: [{ label: 'f(x)', expression: 'x^2', color: 'blue', from: -2, to: 2, dashed: false, samples: [{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }] }] });
      const pdf = await renderGraph(graph, join(folder, 'graph.pdf'), 'pdf');
      const svg = await renderGraph(graph, join(folder, 'graph.svg'), 'svg');
      expect((await readFile(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await readFile(svg, 'utf8'))).toContain('<svg');
    } finally {
      if (!folder.startsWith(testRoot)) throw new Error('Unexpected test output path.');
      await rm(folder, { recursive: true, force: true });
    }
  }, 120_000);
});
