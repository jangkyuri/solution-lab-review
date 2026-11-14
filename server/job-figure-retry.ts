import OpenAI from 'openai';
import type { ApiCost, Job, SolutionResult } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { figureAreaIssues, figureLabelIssues } from './figure-area-review.ts';
import { validateFigureRecipe } from './figure-recipe.ts';
import { repairFigureRecipes } from './generation-figure-repair.ts';
import { figureRecipeInstructions, figureRecipeReferenceInstructions } from './generation-prompts.ts';
import type { Reading } from './generation-schemas.ts';
import { configuredModel } from './generation.ts';

type FigureRetryRequest = { readonly questionNumber: string; readonly stepId: string };
type FigureRetryOptions = { readonly client?: OpenAI; readonly signal?: AbortSignal };
type JobFigureRetryOutcome = { readonly cost: ApiCost | undefined } & (
  { readonly ok: true; readonly result: SolutionResult } | { readonly ok: false; readonly error: AppError }
);
const figureIssue = /그림|그래프|도형|화살|음영|곡선|보조선|라벨|점선|작도|figureRecipe/u;

function repairIssues(job: Job, { questionNumber, stepId }: FigureRetryRequest): readonly string[] {
  const prefix = `${questionNumber}번 ${stepId}`;
  const issues = (job.reviewIssues ?? []).filter((issue) => {
    if (!issue.startsWith(prefix)) return false;
    const suffix = issue.slice(prefix.length);
    return !/^\d/u.test(suffix) && figureIssue.test(suffix);
  });
  return issues.length ? issues : ['해당 단계의 식과 근거에 맞춰 그림의 표시를 바로잡아주세요.'];
}

export async function retryJobFigure(
  job: Job, reading: Reading, request: FigureRetryRequest, options: FigureRetryOptions = {},
): Promise<JobFigureRetryOutcome> {
  const result = job.result;
  const question = result?.questions.at(-1);
  if (job.status !== 'needs_review' || !result || question?.number !== request.questionNumber) {
    throw new AppError(409, '현재 확인할 풀이 초안의 그래프만 다시 그릴 수 있습니다.');
  }
  const step = question.steps.find((item) => item.id === request.stepId);
  if (!step || !reading.questions.some((item) => item.number === question.number)) {
    throw new AppError(404, '그래프를 다시 그릴 단계와 원문 판독 기록을 찾지 못했습니다.');
  }
  if (!options.client && !process.env['OPENAI_API_KEY']?.trim()) {
    throw new AppError(503, 'AI 연결 설정이 필요합니다.');
  }
  const client = options.client ?? new OpenAI({ timeout: 180_000, maxRetries: 0 });
  let cost: ApiCost | undefined;
  try {
    const figureReferences = await figureRecipeReferenceInstructions();
    const fixes = await repairFigureRecipes(client, {
      model: configuredModel(), reading, generated: { questions: [question] },
      targets: [{ ...request, issues: repairIssues(job, request) }],
      instructions: `${figureRecipeInstructions}\n\n${figureReferences}`,
      onApiCost: (usage) => { cost = usage; }, ...(options.signal ? { signal: options.signal } : {}),
    });
    const replacement = fixes?.[0]?.figureRecipe;
    if (!replacement) throw new AppError(503, '그래프를 다시 작성하지 못했습니다. 기존 초안을 유지합니다.');
    const issues = [...figureLabelIssues(replacement), ...figureAreaIssues(replacement, step.latex)];
    if (issues.length) throw new AppError(400, issues.join('\n'));
    await validateFigureRecipe(replacement);
    return { ok: true, cost, result: { ...result, questions: result.questions.map((item) =>
      item === question ? { ...item, steps: item.steps.map((current) =>
        current === step ? { ...current, figureRecipe: replacement } : current) } : item) } };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error, cost };
    if (error instanceof OpenAI.APIError || cost !== undefined) {
      return { ok: false, error: new AppError(503, '그래프 다시 그리기를 마치지 못했습니다. 기존 초안을 유지합니다.'), cost };
    }
    throw error;
  }
}
