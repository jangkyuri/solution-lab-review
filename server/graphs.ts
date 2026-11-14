import { z } from 'zod';
import { GraphSchema } from '../shared/contracts.ts';
import type { Graph, SolutionResult } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { sampleMathExpression } from './math-engine.ts';

export async function sampleExpression(expression: string, from: number, to: number, count = 201, variable = 'x'): Promise<{ x: number; y: number }[]> {
  const result = await sampleMathExpression(expression, from, to, variable, count);
  if (result.segments.length !== 1) throw new AppError(400, '끊어진 그래프는 분리된 구간으로 표시해야 합니다.');
  return result.segments[0] ?? [];
}

async function sampleGraph(input: Graph): Promise<Graph> {
  const graph = GraphSchema.parse(input);
  if (![graph.xMin, graph.xMax, graph.yMin, graph.yMax].every(Number.isFinite)
    || graph.xMin >= graph.xMax || graph.yMin >= graph.yMax || graph.curves.length > 8) {
    throw new AppError(400, '그래프 범위를 확인해야 합니다.');
  }
  // A qualitative sketch is a supplied schematic, not an inferred precise function.
  if (graph.qualitative) return graph;
  const curves = await Promise.all(graph.curves.map(async (curve) => {
    const result = await sampleMathExpression(curve.expression, curve.from, curve.to, graph.variable);
    return { ...curve, segments: result.segments,
      samples: result.segments.length === 1 ? (result.segments[0] ?? []) : [] };
  }));
  return { ...graph, curves };
}

export async function prepareGraphs(result: SolutionResult): Promise<SolutionResult> {
  // Prepare one graph at a time; its eight curves can already be sampled concurrently.
  const questions: SolutionResult['questions'] = [];
  const limitations = new Set(result.limitations);
  for (const question of result.questions) {
    const uncertainties = [...question.uncertainties];
    const steps: typeof question.steps = [];
    for (const step of question.steps) {
      if (!step.graph) { steps.push(step); continue; }
      try {
        steps.push({ ...step, graph: await sampleGraph(step.graph) });
      } catch (error) {
        if (!(error instanceof AppError) && !(error instanceof z.ZodError)) throw error;
        if (error instanceof AppError && error.status !== 400) throw error;
        const detail = error instanceof AppError ? error.message : '그래프 형식을 확인해주세요.';
        if (result.productionVersion) {
          limitations.add(`${question.number}번${step.title ? ` ${step.title}` : ''}: 그래프를 표시하지 못했습니다. ${detail}`);
        } else {
          uncertainties.push(`${step.title || question.number}: 그래프를 표시하지 못했습니다. ${detail}`);
        }
        steps.push({ ...step, graph: null });
      }
    }
    questions.push({ ...question, uncertainties, steps });
  }
  return { ...result, questions, limitations: result.productionVersion ? [...limitations] : result.limitations };
}
