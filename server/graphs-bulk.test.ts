import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultSchema } from '../shared/contracts.ts';
import type { SolutionResult } from '../shared/contracts.ts';
import { prepareGraphs } from './graphs.ts';

function bulkResult(): SolutionResult {
  return ResultSchema.parse({
    summary: '', references: [], limitations: [],
    questions: Array.from({ length: 4 }, (_, question) => ({
      number: String(question + 1), problemText: '', firstDecision: '', variables: ['x'],
      observedOrder: [], answer: '', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
      steps: Array.from({ length: 3 }, (_, step) => ({
        id: `S${step + 1}`, title: `Graph ${step + 1}`, explanation: '', latex: '', originalStep: '', evidence: '',
        graph: {
          title: '', xMin: -1, xMax: 1, yMin: -1, yMax: 2, xLabel: 'x', yLabel: 'y',
          points: [], verticals: [], explanation: '',
          curves: ['x', 'x^2'].map((expression) => ({
            label: expression, expression, color: 'blue', from: -1, to: 1, dashed: false, samples: [],
          })),
        },
      })),
    })),
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('bulk graph preparation', () => {
  it('keeps every valid graph when the result needs more samples than the worker queue holds', async () => {
    // Given 24 valid curves across several questions and steps.
    const input = bulkResult();
    // When the complete result is prepared with the real math worker.
    const prepared = await prepareGraphs(input);
    // Then no graph disappears and every curve receives actual sampled segments.
    expect(prepared.questions.flatMap((question) => question.steps).filter((step) => step.graph !== null)).toHaveLength(12);
    expect(prepared.questions.every((question) => question.uncertainties.length === 0)).toBe(true);
    expect(prepared.questions.flatMap((question) => question.steps)
      .every((step) => step.graph?.curves.every((curve) => curve.segments.length === 1))).toBe(true);
  }, 120_000);

  it('preserves the source payload and rejects when the math runtime is unavailable', async () => {
    // Given valid graphs with a missing execution environment.
    const input = bulkResult();
    const before = JSON.stringify(input);
    vi.stubEnv('SOLUTION_LAB_PYTHON', path.join(tmpdir(), randomUUID(), 'missing.exe'));
    // When graph preparation meets an infrastructure failure.
    const preparation = prepareGraphs(input);
    // Then it fails instead of publishing a graphless success, and the source remains intact.
    await expect(preparation).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify(input)).toBe(before);
  });
});
