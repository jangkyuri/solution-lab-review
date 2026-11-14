import { z } from 'zod';
import type { Graph, SolutionResult } from './contracts.ts';

const xBound = z.number().min(-100_000).max(100_000);
const yBound = z.number().min(-100_000_000).max(100_000_000);

export const GraphBoundsSchema = z.object({
  xMin: xBound, xMax: xBound, yMin: yBound, yMax: yBound,
}).refine(bounds => bounds.xMin < bounds.xMax && bounds.yMin < bounds.yMax);

export type GraphBounds = z.infer<typeof GraphBoundsSchema>;

export function applyCurveAccent(result: SolutionResult, color: Graph['curves'][number]['color']): SolutionResult {
  let changed = false;
  const questions = result.questions.map(question => ({
    ...question,
    steps: question.steps.map(step => {
      const first = step.graph?.curves[0];
      if (step.figureRecipe || !step.graph || !first || first.color === color) return step;
      changed = true;
      return { ...step, graph: { ...step.graph, curves: [{ ...first, color }, ...step.graph.curves.slice(1)] } };
    }),
  }));
  return changed ? { ...result, questions } : result;
}
