import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { ApiCost, Job, ApprovedCase, SolutionResult } from '../shared/contracts.ts';
import type { KnowledgeLibrary } from '../shared/knowledge.ts';
import type { StoredFile } from './store.ts';
import { AppError } from './errors.ts';
import { loadKnowledge } from './knowledge.ts';
import { getRules } from './reference-rules.ts';
import { handSolutionRules } from './hand-solution-rules.ts';
import { buildReadingInput, buildWriterEvidence, selectMethodEvidence } from './generation-input.ts';
import { finalizeGeneration } from './generation-finalize.ts';
import { figureRecipeInstructions, figureRecipeReferenceInstructions, generationInstructions, generationMaterial, productionRuleInstructions, readingInstructions } from './generation-prompts.ts';
import { ReadingSchema, WriterResultSchema } from './generation-schemas.ts';
import { validateStepGraph } from './generation-validation.ts';
import { generationQualityIssues } from './generation-quality.ts';
import { reviewGeneratedStudentText } from './generation-review.ts';
import type { GeneratedResult, Reading } from './generation-schemas.ts';
import { normalizeReadingNumbers } from './reading-number.ts';
import { correctionTargets, mergeScopedCorrection } from './generation-correction.ts';
import { generationBatches, mergeGenerationBatches, orderScopedDraft } from './generation-batches.ts';
import { validateFigureRecipe } from './figure-recipe.ts';
import { figureAreaIssues, figureLabelIssues } from './figure-area-review.ts';
import { repairGeneratedFigures } from './generation-figure-repair.ts';
import { trackApiCost } from './track-api-cost.ts';

type FigureIssue = { readonly questionNumber: string; readonly stepId: string; readonly issues: readonly string[] };
const figureIssuePrefix = '[그림만] ';

function figureReviewTargets(draft: GeneratedResult, issues: readonly string[]): FigureIssue[] {
  const targets = draft.questions.flatMap((question) => question.steps.map((step) => ({
    questionNumber: question.number, stepId: step.id, prefix: `${figureIssuePrefix}${question.number}번 ${step.id}: `,
  })));
  if (issues.some((issue) => targets.filter(({ prefix }) => issue.startsWith(prefix)).length !== 1)) return [];
  return targets.flatMap(({ questionNumber, stepId, prefix }) => {
    const messages = issues.filter((issue) => issue.startsWith(prefix)).map((issue) => issue.slice(prefix.length));
    return messages.length ? [{ questionNumber, stepId, issues: messages }] : [];
  });
}

function figureIssueMessages(issues: readonly FigureIssue[]): string[] {
  return issues.flatMap(({ questionNumber, stepId, issues: messages }) => messages.map((message) => `${questionNumber}번 ${stepId}: ${message}`));
}

export type GenerationOptions = {
  readonly signal?: AbortSignal;
  readonly client?: OpenAI;
  readonly knowledgeLoader?: () => Promise<KnowledgeLibrary>;
  readonly onApiCost?: (phase: 'reading' | 'question', cost: ApiCost) => void;
  readonly question?: {
    readonly index: number;
    readonly reading?: Reading;
    readonly onReading?: (reading: Reading) => void;
  };
};

export function configuredModel(): string {
  return process.env['OPENAI_MODEL']?.trim() || 'gpt-6-luna';
}

function apiFailure(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof OpenAI.APIError) {
    switch (error.status) {
      case 401:
      case 403: throw new AppError(503, 'AI 연결 권한을 확인해야 합니다. 저장한 자료는 유지됩니다.');
      case 429: throw new AppError(503, 'AI 사용량 또는 요청 한도에 도달했습니다. 잠시 후 다시 실행해주세요.');
      default: throw new AppError(503, 'AI가 요청을 완료하지 못했습니다. 파일 범위와 연결 상태를 확인한 뒤 다시 실행해주세요.');
    }
  }
  if (error instanceof OpenAI.APIUserAbortError || error instanceof OpenAI.APIConnectionTimeoutError) {
    throw new AppError(503, 'AI 작업이 취소되었거나 시간이 초과되었습니다. 범위를 줄여 다시 실행해주세요.');
  }
  if (error instanceof Error && error.name === 'AbortError') throw new AppError(503, '작업이 취소되었습니다.');
  throw new AppError(503, 'AI 결과를 처리하지 못했습니다. 원본 자료와 조건을 다시 확인해주세요.');
}

export async function generateSolution(
  job: Job, files: readonly StoredFile[], _cases: readonly ApprovedCase[], options: GenerationOptions = {},
): Promise<{ readonly result: SolutionResult; readonly model: string; readonly reviewIssues?: readonly string[] }> {
  if (!options.client && !process.env['OPENAI_API_KEY']?.trim()) throw new AppError(503, 'AI 연결 설정이 필요합니다.');
  const client = options.client ?? new OpenAI({ timeout: 180_000, maxRetries: 0 });
  const model = configuredModel();
  const requestOptions = options.signal ? { signal: options.signal } : {};
  const onReadingCost = options.onApiCost ? (cost: ApiCost) => options.onApiCost?.('reading', cost) : undefined;
  const onQuestionCost = options.onApiCost ? (cost: ApiCost) => options.onApiCost?.('question', cost) : undefined;
  try {
    const [knowledge, criteria, handRules, figureReferences] = await Promise.all([
      (options.knowledgeLoader ?? loadKnowledge)(), getRules(), handSolutionRules(job.subject), figureRecipeReferenceInstructions(),
    ]);
    const read = async (): Promise<Reading> => {
      const content = await buildReadingInput(job, files);
      const response = await trackApiCost(() => client.responses.parse({
        model, store: false, max_output_tokens: 12_000,
        input: [{ role: 'system', content: `${readingInstructions}\n\n${productionRuleInstructions(handRules)}\n이 요청에서는 v1 기준 중 판독과 원문 보존에 해당하는 부분만 적용한다. 풀이·정답·그래프를 작성하지 않는다.` }, { role: 'user', content }],
        text: { format: zodTextFormat(ReadingSchema, 'exam_reading') },
      }, requestOptions), onReadingCost);
      if (!response.output_parsed || response.status !== 'completed') throw new AppError(503, '자료 판독이 끝나지 않았습니다. 문항 범위를 나눠 다시 실행해주세요.');
      const normalized = normalizeReadingNumbers(response.output_parsed);
      if (normalized.questions.length === 0 || normalized.questions.some((question) => !question.problemText.trim())) {
        throw new AppError(400, '문제 내용을 읽지 못했습니다. 선명한 원본이나 문제 텍스트를 넣어주세요.');
      }
      if (new Set(normalized.questions.map((question) => question.number)).size !== normalized.questions.length) {
        throw new AppError(503, '판독한 문항 번호가 중복되어 다시 확인해야 합니다.');
      }
      for (const question of normalized.questions) validateStepGraph(question.observedSteps);
      options.question?.onReading?.(normalized);
      return normalized;
    };
    const reading = options.question?.reading ?? await read();
    const selected = options.question && reading.questions[options.question.index];
    if (options.question && !selected) throw new AppError(409, '작성할 문항을 찾지 못했습니다. 진행 상태를 다시 확인해주세요.');
    const outputReading = selected ? { ...reading, questions: [selected] } : reading;
    const examples = selectMethodEvidence(knowledge.problems, outputReading.questions.flatMap((question) => question.retrievalTerms));
    const writerInstructions = `${generationInstructions(job)}\n\n${productionRuleInstructions(handRules)}\n\n${figureReferences}`;
    const writerSchema = selected ? WriterResultSchema.extend({
      questions: z.array(WriterResultSchema.shape.questions.element.extend({ number: z.enum([selected.number]) })).length(1),
    }) : WriterResultSchema;
    const writerFormat = zodTextFormat(writerSchema, 'solution_draft');
    const generateBatch = async (batchReading: Reading) => {
      const questionNumbers = batchReading.questions.map((question) => question.number);
      const write = async (corrections: readonly string[], previousStudentDraft: GeneratedResult | null = null) => {
        const targets = previousStudentDraft === null ? null : correctionTargets(batchReading, { previous: previousStudentDraft, issues: corrections });
        const scope = targets ? [...targets].map(([number, ids]) => `${number}번 ${[...ids].join(', ')}`).join(' / ') : '';
        const evidenceReading = targets ? { ...batchReading, questions: batchReading.questions.filter((question) => targets.has(question.number)) } : batchReading;
        const writerEvidence = await buildWriterEvidence(job, files, evidenceReading, { correction: previousStudentDraft !== null });
        const response = await trackApiCost(() => client.responses.parse({
          model, store: false, max_output_tokens: 20_000,
          input: [
            { role: 'system', content: writerInstructions + '\n첨부 파일에는 다른 문항이 함께 있을 수 있다. 이번 요청에서는 questionScope.questionNumbers에 명시한 문항만 하나씩 작성한다. 각 결과의 number에는 받은 식별자를 글자 그대로 쓴다. 미확인-1 같은 식별자는 문항 연결에 쓰이므로 미확인이나 다른 숫자로 바꾸지 않는다. 해당 문항의 원래 단계·분기·미지수와 판독 내용을 유지하고 다른 문항을 추가하거나 빠뜨리지 않는다.' + (corrections.length ? `\n이전 초안의 자동 점검 결과를 반영해 다시 작성한다. previousStudentDraft는 앞서 생성한 학생용 초안이며 원문이 아니다. 원문 판독과 첨부를 기준으로 원래 id·순서·분기와 수학적으로 맞는 부분을 보존하고, 지적된 문제에 필요한 부분을 보완한다.${scope ? ` 수정 대상은 ${scope}이다. 그 밖의 단계와 문항 정답·강조·표는 이전 초안 그대로 보존한다.` : ''} 이번 요청 범위의 전체 결과는 정해진 구조로 다시 반환한다.\n${corrections.join('\n')}` : '') },
            { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ questionScope: { questionNumbers } }) },
              { type: 'input_text', text: generationMaterial(job, batchReading, examples, criteria.text) }, ...writerEvidence] },
            ...(previousStudentDraft === null ? [] : [{ role: 'user' as const, content: JSON.stringify({ sourceKind: 'generated_draft_not_original', previousStudentDraft, correctionIssues: corrections }) }]),
          ],
          text: { format: writerFormat },
        }, requestOptions), onQuestionCost);
        if (!response.output_parsed || response.status !== 'completed') {
          throw new AppError(503, `풀이 작성이 끝나지 않았습니다. 대상 문항: ${questionNumbers.join(', ')}. 다시 실행해주세요.`);
        }
        const generated = orderScopedDraft(batchReading, {
          ...response.output_parsed,
          questions: response.output_parsed.questions.map((question) => ({
            ...question, steps: question.steps.map((step) => ({ ...step, graph: null })),
          })),
        });
        return { generated: previousStudentDraft === null ? generated
          : orderScopedDraft(batchReading, mergeScopedCorrection(batchReading, { previous: previousStudentDraft, regenerated: generated, issues: corrections })), model: response.model };
      };
      const inspectedRecipes = new Map<string, string | null>();
      const inspect = async (generated: GeneratedResult): Promise<readonly FigureIssue[]> => {
        const figureIssues: FigureIssue[] = [];
        for (const question of generated.questions) {
          for (const step of question.steps) {
            const recipe = step.figureRecipe;
            if (recipe == null) continue;
            options.signal?.throwIfAborted();
            const labels = figureLabelIssues(recipe);
            if (labels.length) {
              figureIssues.push({ questionNumber: question.number, stepId: step.id, issues: labels });
              continue;
            }
            if (!inspectedRecipes.has(recipe)) {
              try {
                await validateFigureRecipe(recipe);
                inspectedRecipes.set(recipe, null);
              } catch (error) {
                if (!(error instanceof AppError) || error.status !== 400) throw error;
                const issue = /no readable label position/iu.test(error.message)
                  ? '라벨을 겹치지 않게 배치할 수 없습니다. 방향과 화면 여백을 조정하세요.'
                  : '그림을 그릴 수 없습니다. JSON 필드와 라벨 대상, 수식 표기, 구간 및 좌표를 다시 확인해주세요.';
                inspectedRecipes.set(recipe, issue);
              }
            }
            const renderIssue = inspectedRecipes.get(recipe);
            const issues = renderIssue ? [renderIssue] : figureAreaIssues(recipe, step.latex);
            if (issues.length) figureIssues.push({ questionNumber: question.number, stepId: step.id, issues });
          }
        }
        return figureIssues;
      };
      const review = (generated: GeneratedResult) => reviewGeneratedStudentText(client, {
        model, mode: job.mode, pdfDesign: job.pdfDesign, productionRules: handRules, userInstruction: job.instruction,
        reading: batchReading, generated, onApiCost: onQuestionCost, ...(options.signal ? { signal: options.signal } : {}),
      });
      const localCheck = async (generated: GeneratedResult) => {
        const figures = await inspect(generated);
        const text = generationQualityIssues(job, batchReading, generated);
        return { figures, text, issues: [...figureIssueMessages(figures), ...text] };
      };
      let draft = await write([]);
      let remainingIssues: readonly string[] = [];
      try {
        const firstCheck = await localCheck(draft.generated);
        remainingIssues = firstCheck.issues.length ? firstCheck.issues : await review(draft.generated);
        if (!remainingIssues.length) return { ...draft, issues: remainingIssues };
        const targets = firstCheck.issues.length
          ? firstCheck.text.length ? [] : firstCheck.figures
          : figureReviewTargets(draft.generated, remainingIssues);
        if (targets.length) {
          const generated = await repairGeneratedFigures(client, {
            model, reading: batchReading, generated: draft.generated, targets,
            instructions: `${figureRecipeInstructions}\n\n${figureReferences}`,
            ...(onQuestionCost ? { onApiCost: onQuestionCost } : {}), ...requestOptions,
          });
          if (!generated) return { ...draft, issues: remainingIssues };
          const repairCheck = await localCheck(generated);
          if (repairCheck.issues.length) return { ...draft, issues: remainingIssues };
          draft = { ...draft, generated };
        } else {
          const corrected = await write(remainingIssues, draft.generated);
          finalizeGeneration(corrected.generated, batchReading, job.mode, knowledge, examples, reading.questions.length);
          draft = corrected;
        }
        const lastCheck = await localCheck(draft.generated);
        remainingIssues = lastCheck.issues;
        return { ...draft, issues: lastCheck.issues.length ? lastCheck.issues : await review(draft.generated) };
      } catch (error) {
        options.signal?.throwIfAborted();
        if (!(error instanceof AppError) && !(error instanceof OpenAI.APIError) && !(error instanceof z.ZodError)) throw error;
        return { ...draft, issues: [...remainingIssues, '자동 검토 또는 수정을 마치지 못했습니다. 풀이를 확인해주세요.'] };
      }
    };
    const drafts: Awaited<ReturnType<typeof generateBatch>>[] = [];
    for (const batch of generationBatches(outputReading)) drafts.push(await generateBatch(batch));
    const generated = mergeGenerationBatches(outputReading, drafts.map((draft) => draft.generated));
    const reviewIssues = [...new Set(drafts.flatMap(({ issues }) => issues))]
      .map((issue) => issue.replace(figureIssuePrefix, '').replaceAll('booklet.referenceTip', '참고 설명'));
    return { result: finalizeGeneration(generated, outputReading, job.mode, knowledge, examples, reading.questions.length),
      model: [...new Set(drafts.map((draft) => draft.model))].join(', '), ...(reviewIssues.length ? { reviewIssues } : {}) };
  } catch (error) {
    return apiFailure(error);
  }
}
