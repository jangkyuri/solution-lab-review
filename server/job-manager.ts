import { hasRemainingQuestions, QUESTION_APPROVAL_BATCH_SIZE } from '../shared/contracts.ts';
import type { ApprovedCase, Job, SolutionResult } from '../shared/contracts.ts';
import { applyCurveAccent } from '../shared/graph-design.ts';
import { AppError, safeMessage } from './errors.ts';
import type { Reading } from './generation-schemas.ts';
import type { GenerationOptions } from './generation.ts';
import { prepareGraphs } from './graphs.ts';
import type { Store, StoredFile } from './store.ts';
import { addApiCost } from './api-cost.ts';

export type Generator = (
  job: Job, files: readonly StoredFile[], cases: readonly ApprovedCase[], options: GenerationOptions,
) => Promise<{ readonly result: SolutionResult; readonly model: string; readonly reviewIssues?: readonly string[] }>;

function appendQuestion(previous: SolutionResult | null, current: SolutionResult): SolutionResult {
  if (previous === null) return current;
  const references = new Map(previous.references.map(reference => [reference.id, reference]));
  for (const reference of current.references) {
    const original = references.get(reference.id);
    const reasons = new Set([...(original?.reason.split('\n') ?? []), ...reference.reason.split('\n')]);
    references.set(reference.id, { ...reference, reason: [...reasons].filter(Boolean).join('\n') });
  }
  const mixedSnapshots = previous.provenance?.snapshotId !== current.provenance?.snapshotId;
  const provenance = previous.provenance && current.provenance && !mixedSnapshots
    ? { ...previous.provenance, sampleIds: [...references.keys()] }
    : null;
  return {
    ...previous, questions: [...previous.questions, ...current.questions], references: [...references.values()], provenance,
    limitations: [...new Set([...previous.limitations, ...current.limitations,
      ...(mixedSnapshots ? ['문항별로 확인한 참고 자료의 기록 시점이 다릅니다.'] : []),
    ])],
  };
}

export class JobManager {
  private readonly active = new Map<string, Promise<void>>();
  private readonly store: Store;
  private readonly generator: Generator;
  private readonly apiConfigured: boolean;
  constructor(store: Store, generator: Generator, apiConfigured: boolean) {
    this.store = store;
    this.generator = generator;
    this.apiConfigured = apiConfigured;
  }

  start(id: string): Job {
    const job = this.store.getJob(id);
    if (job.status === 'needs_review') throw new AppError(409, '먼저 저장된 풀이 초안을 확인해주세요.');
    if (job.status === 'awaiting_next') throw new AppError(409, '작성한 문항을 확인한 뒤 다음 묶음을 허용해주세요.');
    const progress = job.progress;
    if (progress && (job.status !== 'failed' || !hasRemainingQuestions(job) || progress.authorizedCount === progress.completedCount)) {
      throw new AppError(409, '이미 문항 작성이 진행 중이거나 완료되었습니다.');
    }
    if (progress && progress.authorizedCount === undefined) {
      // The previous workflow granted one question at a time.
      return this.launch({ ...job, progress: { ...progress, authorizedCount: progress.completedCount + 1 } });
    }
    return this.launch(job);
  }

  next(id: string, completedCount: number): Job {
    const job = this.store.getJob(id);
    const progress = job.progress;
    if (job.status !== 'awaiting_next' || !hasRemainingQuestions(job) || progress?.completedCount !== completedCount) {
      throw new AppError(409, '다음 문항을 허용할 수 있는 상태가 아닙니다. 최신 작업을 확인해주세요.');
    }
    const authorizedCount = progress.authorizedCount && progress.authorizedCount > completedCount
      ? progress.authorizedCount
      : Math.min(completedCount + QUESTION_APPROVAL_BATCH_SIZE, progress.questionNumbers.length);
    return this.launch({ ...job, progress: { ...progress, authorizedCount } });
  }

  private launch(job: Job): Job {
    if (!this.apiConfigured) throw new AppError(503, '연결한 AI 사용 설정을 확인해주세요.');
    if (this.active.size > 0 || job.status === 'running') throw new AppError(409, '현재 풀이를 마친 뒤 다음 작업을 실행해주세요.');
    const running = this.store.saveJob({ ...job, status: 'running', result: job.progress ? job.result : null,
      model: job.progress ? job.model : null, error: null, updatedAt: new Date().toISOString() }, 'started');
    this.store.removeCase(job.id);
    const task = this.generate(running).finally(() => this.active.delete(job.id));
    this.active.set(job.id, task);
    return running;
  }

  async idle(): Promise<void> { await Promise.all(this.active.values()); }

  private async generate(job: Job): Promise<void> {
    let running = job;
    try {
      const files = this.store.filesForJob(job.id);
      const cases = this.store.listCases();
      let reading = job.progress ? this.store.getReading(job.id) : undefined;
      while (running.status === 'running') {
        const index = running.progress?.completedCount ?? 0;
        const question = reading ? { index, reading } : {
          index,
          onReading: (source: Reading) => {
            const questionNumbers = source.questions.map(item => item.number);
            const authorizedCount = Math.min(questionNumbers.length, QUESTION_APPROVAL_BATCH_SIZE);
            const [onlyQuestion] = questionNumbers;
            const questionApiCosts = onlyQuestion && questionNumbers.length === 1 && running.readingApiCost
              ? { ...running.questionApiCosts, [onlyQuestion]: running.readingApiCost }
              : running.questionApiCosts;
            running = this.store.saveJob({ ...running, questionApiCosts,
              progress: { completedCount: 0, questionNumbers, authorizedCount }, updatedAt: new Date().toISOString() }, 'read', source);
            reading = source;
          },
        };
        const generated = await this.generator(running, files, cases, {
          question,
          onApiCost: (phase, cost) => {
            const apiCost = addApiCost(running.apiCost, cost);
            const number = running.progress?.questionNumbers[index];
            const next = phase === 'reading'
              ? { ...running, apiCost, readingApiCost: addApiCost(running.readingApiCost, cost) }
              : { ...running, apiCost, ...(number === undefined ? {} : {
                questionApiCosts: { ...running.questionApiCosts,
                  [number]: addApiCost(running.questionApiCosts?.[number], cost) },
              }) };
            running = this.store.saveJob(next, null);
          },
        });
        const progress = running.progress;
        const number = progress?.questionNumbers[index];
        if (progress?.authorizedCount === undefined || index >= progress.authorizedCount || !number
          || generated.result.questions.length !== 1 || generated.result.questions[0]?.number !== number) {
          throw new AppError(503, '작성 결과가 이번에 허용한 문항과 일치하지 않습니다. 다시 실행해주세요.');
        }
        const prepared = await prepareGraphs(generated.result);
        const accent = job.initialDesign?.curveColor;
        const current = accent ? applyCurveAccent(prepared, accent) : prepared;
        const result = appendQuestion(running.result, current);
        const completedCount = index + 1;
        const model = [...new Set([...(running.model?.split(', ') ?? []), generated.model])].join(', ');
        const reviewIssues = generated.reviewIssues?.length ? [...new Set(generated.reviewIssues)] : undefined;
        const status = reviewIssues ? 'needs_review' : completedCount === progress.questionNumbers.length ? 'ready'
          : completedCount === progress.authorizedCount ? 'awaiting_next' : 'running';
        running = this.store.saveJob({ ...running, progress: { ...progress, completedCount }, result, model,
          ...(reviewIssues ? { reviewIssues } : {}), status, error: null, updatedAt: new Date().toISOString() }, 'generated');
      }
    } catch (error) {
      this.store.saveJob({ ...running, status: 'failed', error: safeMessage(error), updatedAt: new Date().toISOString() }, 'failed');
    }
  }
}
