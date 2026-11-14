import { createServer } from 'node:http';
import type { Server } from 'node:http';
import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateSolution } from './generation.ts';
import { generatedFixture, jobFixture, libraryFixture, readingFixture } from './generation-fixtures.ts';
import type { GeneratedResult, Reading } from './generation-schemas.ts';
import { ReadingSchema } from './generation-schemas.ts';

const WireRequest = z.object({
  model: z.string(), text: z.object({ format: z.object({ name: z.string(), schema: z.unknown() }) }),
  input: z.array(z.object({ role: z.string(), content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())]) })),
});
const Material = z.object({ reading: ReadingSchema });
const Scope = z.object({ questionScope: z.object({ questionNumbers: z.array(z.string()) }) });
const Review = z.object({ sourceReading: z.array(z.object({ number: z.string() })) });
type Capture = { readonly stage: string; readonly numbers: readonly string[]; readonly explicit: readonly string[] | undefined };
type Harness = { readonly client: OpenAI; readonly calls: Capture[]; readonly draftSchemas: readonly unknown[]; readonly close: () => Promise<void> };
type DraftChange = (draft: GeneratedResult, numbers: readonly string[], attempt: number) => GeneratedResult | null;

function readingFor(count: number): Reading {
  const original = readingFixture.questions[0];
  if (!original) throw new Error('Missing original fixture');
  return { ...structuredClone(readingFixture),
    coverage: { pageCount: 3, detectedQuestionCount: count, unreadableQuestionNumbers: ['99'], complete: false },
    questions: Array.from({ length: count }, (_, index) => ({ ...structuredClone(original), number: String(index + 1),
      printedNumberPrefix: `${index + 1}. 함수`, problemText: `${index + 1}. 함수 f(x)=x^2의 도함수를 구하여라.`,
      observedSteps: [{ id: 'S01', text: 'f(x+h)-f(x)', after: [], branch: null },
        { id: 'S02', text: "f'(x)=2x", after: ['S01'], branch: '계산' }],
    })), limitations: ['추가 범위는 미확인이다.'],
  };
}

function draftFor(numbers: readonly string[]): GeneratedResult {
  const base = generatedFixture();
  const question = base.questions[0];
  const step = question?.steps[0];
  if (!question || !step) throw new Error('Missing writing fixture');
  return { ...base, questions: numbers.map((number) => ({ ...structuredClone(question), number,
    steps: [{ ...structuredClone(step) }, { ...structuredClone(step), id: 'S02', after: ['S01'], branch: '계산' }],
  })).reverse(), references: [{ id: 'P01', title: 'untrusted model title', reason: `문항 ${numbers.join(',')}의 미분계수 판단에 적용한다.` }],
    limitations: ['공통 확인 사항이다.'] };
}

async function harness(reading: Reading, change?: DraftChange, correctFirst = false): Promise<Harness> {
  const calls: Capture[] = [];
  const draftSchemas: unknown[] = [];
  const attempts = new Map<string, number>();
  let reviewCount = 0;
  const server: Server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = WireRequest.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const stage = body.text.format.name;
      const texts = body.input.filter((item) => item.role === 'user').flatMap((item) => typeof item.content === 'string'
        ? [item.content] : item.content.flatMap((part) => part.text ? [part.text] : []));
      const objects: unknown[] = texts.map((text) => JSON.parse(text));
      const material = objects.map((value) => Material.safeParse(value)).find((value) => value.success);
      const explicit = objects.map((value) => Scope.safeParse(value)).find((value) => value.success);
      const review = objects.map((value) => Review.safeParse(value)).find((value) => value.success);
      const numbers = stage === 'exam_reading' ? reading.questions.map((question) => question.number)
        : material?.success ? material.data.reading.questions.map((question) => question.number)
          : review?.success ? review.data.sourceReading.map((question) => question.number) : [];
      calls.push({ stage, numbers, explicit: explicit?.success ? explicit.data.questionScope.questionNumbers : undefined });
      let output: unknown = reading;
      let complete = true;
      if (stage === 'solution_draft') {
        draftSchemas.push(body.text.format.schema);
        const key = numbers.join(',');
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        const draft = numbers.length > 3 ? null : change ? change(draftFor(numbers), numbers, attempt) : draftFor(numbers);
        complete = draft !== null;
        output = draft;
      } else if (stage === 'student_math_review') {
        reviewCount += 1;
        output = { issues: correctFirst && reviewCount === 1 ? ['1번 S01 단계 수식을 확인한다.'] : [] };
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `resp_${calls.length}`, object: 'response', created_at: 0, status: complete ? 'completed' : 'incomplete', model: 'local-batch-test',
        error: null, incomplete_details: complete ? null : { reason: 'max_output_tokens' },
        output: complete ? [{ id: `msg_${calls.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }] : [],
      }));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'test request failed' } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local port');
  return { client: new OpenAI({ apiKey: 'test-only', baseURL: `http://127.0.0.1:${address.port}/v1`, maxRetries: 0 }), calls, draftSchemas,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const job = { ...jobFixture, mode: 'supplement' as const };

describe('bounded multi-question generation through the real SDK', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('checkpoints the full normalized reading before writing and reviewing the first question only', async () => {
    const reading = readingFor(4);
    const api = await harness(reading);
    const onReading = vi.fn<(reading: Reading) => void>(() => {
      expect(api.calls.map((call) => call.stage)).toEqual(['exam_reading']);
    });
    const options = { client: api.client, knowledgeLoader: async () => libraryFixture, question: { index: 0, onReading } };
    try {
      const { result } = await generateSolution(job, [], [], options);
      expect(onReading).toHaveBeenCalledExactlyOnceWith({ ...reading, questions: reading.questions.map((question) => ({
        ...question, problemText: '함수 f(x)=x^2의 도함수를 구하여라.',
      })) });
      expect(api.calls.slice(1)).toEqual([
        { stage: 'solution_draft', numbers: ['1'], explicit: ['1'] },
        { stage: 'student_math_review', numbers: ['1'], explicit: ['1'] },
      ]);
      expect(result.questions.map((question) => question.number)).toEqual(['1']);
      expect(result.limitations.some((item) => item.includes('99'))).toBe(true);
      expect(result.limitations.some((item) => item.includes('전체 4문항 중'))).toBe(false);
    } finally { await api.close(); }
  });

  it('continues from a saved reading and constrains the writer to its exact unprinted identifier', async () => {
    const reading = readingFor(4);
    const checkpoint = { ...reading, questions: reading.questions.map((question, index) => ({
      ...question, number: `미확인-${index + 1}`, printedNumberPrefix: null, problemText: '함수 f(x)=x^2의 도함수를 구하여라.',
    })) };
    const api = await harness(reading);
    const options = { client: api.client, knowledgeLoader: async () => libraryFixture, question: { index: 1, reading: checkpoint } };
    try {
      const { result } = await generateSolution(job, [], [], options);
      expect(api.calls).toEqual([
        { stage: 'solution_draft', numbers: ['미확인-2'], explicit: ['미확인-2'] },
        { stage: 'student_math_review', numbers: ['미확인-2'], explicit: ['미확인-2'] },
      ]);
      expect(api.draftSchemas).toMatchObject([{ properties: { questions: {
        minItems: 1, maxItems: 1, items: { properties: { number: { enum: ['미확인-2'] } } },
      } } }]);
      expect(result.questions.map((question) => question.number)).toEqual(['미확인-2']);
    } finally { await api.close(); }
  });

  it('completes eleven questions in sequential bounded writing and review scopes without losing original order or coverage', async () => {
    // Given: the local service cannot finish a writing response larger than three questions.
    const reading = readingFor(11);
    const api = await harness(reading);
    try {
      // When
      const result = await generateSolution(job, [], [], { client: api.client, knowledgeLoader: async () => libraryFixture });
      // Then: all questions and original per-question steps survive, with no lexical sorting.
      const groups = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['10', '11']];
      expect(api.calls.filter((call) => call.stage === 'exam_reading')).toHaveLength(1);
      expect(api.calls.filter((call) => call.stage === 'solution_draft').map((call) => [call.numbers, call.explicit])).toEqual(groups.map((group) => [group, group]));
      expect(api.calls.filter((call) => call.stage === 'student_math_review').map((call) => call.numbers)).toEqual(groups);
      expect(result.result.questions.map((question) => question.number)).toEqual(reading.questions.map((question) => question.number));
      expect(result.result.questions.every((question) => question.steps[1]?.id === 'S02' && question.steps[1].after[0] === 'S01'
        && question.steps[1].branch === '계산' && question.steps[0]?.originalStep === 'f(x+h)-f(x)')).toBe(true);
      expect(result.result.provenance?.snapshotId).toBe(libraryFixture.summary.snapshotId);
      expect(result.result.provenance?.sampleIds).toEqual(['P01']);
      expect(result.result.limitations).toContain(reading.limitations[0]);
      expect(result.result.limitations.some((item) => item.includes('99'))).toBe(true);
      expect(result.result.references[0]?.reason).toEqual(expect.stringContaining('10,11'));
      expect(result.result.references[0]?.reason).toEqual(expect.stringContaining('1,2,3'));
      expect(result.model).toBe('local-batch-test');
    } finally { await api.close(); }
  });

  it.each([1, 3])('keeps %s-question inputs on one writing and review request', async (count) => {
    // Given
    const reading = readingFor(count); const api = await harness(reading);
    try {
      // When
      const result = await generateSolution(job, [], [], { client: api.client, knowledgeLoader: async () => libraryFixture });
      // Then
      expect(api.calls.map((call) => call.stage)).toEqual(['exam_reading', 'solution_draft', 'student_math_review']);
      expect(result.result.questions).toHaveLength(count);
    } finally { await api.close(); }
  });

  it.each(['missing', 'duplicate', 'extra', 'wrong', 'incomplete'] as const)('rejects a %s second batch without running later batches or returning partial success', async (fault) => {
    // Given
    const api = await harness(readingFor(8), (draft, numbers) => {
      if (numbers[0] !== '4') return draft;
      const first = draft.questions[0];
      if (!first) throw new Error('Missing second batch fixture');
      switch (fault) {
        case 'missing': return { ...draft, questions: draft.questions.slice(1) };
        case 'duplicate': return { ...draft, questions: draft.questions.map(() => structuredClone(first)) };
        case 'extra': return { ...draft, questions: [...draft.questions, { ...structuredClone(first), number: '99' }] };
        case 'wrong': return { ...draft, questions: draft.questions.map((question, index) => index === 0 ? { ...question, number: '99' } : question) };
        case 'incomplete': return null;
      }
    });
    try {
      // When / Then
      await expect(generateSolution(job, [], [], { client: api.client, knowledgeLoader: async () => libraryFixture })).rejects.toMatchObject({ status: 503 });
      expect(api.calls.filter((call) => call.stage === 'solution_draft').map((call) => call.numbers)).toEqual([['1', '2', '3'], ['4', '5', '6']]);
      expect(api.calls.filter((call) => call.stage === 'student_math_review')).toHaveLength(1);
    } finally { await api.close(); }
  });

  it('retains each distinct reference reason once across three or more batches', async () => {
    // Given: separate scopes use the same reference, including a later repeated reason.
    const api = await harness(readingFor(11), (draft, numbers) => ({ ...draft,
      references: [{ id: 'P01', title: 'model title', reason: numbers[0] === '7' ? '추가 근거' : '공통 근거' }],
    }));
    try {
      // When
      const result = await generateSolution(job, [], [], { client: api.client, knowledgeLoader: async () => libraryFixture });
      // Then
      expect(result.result.references).toHaveLength(1);
      expect(result.result.references[0]?.reason.split('\n')).toEqual(['공통 근거', '추가 근거']);
    } finally { await api.close(); }
  });
  it('checks correction response scope before a scoped correction can hide an extra question', async () => {
    // Given: the first review requests one step repair, then the writer returns an out-of-scope question.
    const api = await harness(readingFor(4), (draft, _numbers, attempt) => {
      const first = draft.questions[0];
      if (!first) throw new Error('Missing correction fixture');
      return attempt === 2 ? { ...draft, questions: [...draft.questions, { ...structuredClone(first), number: '99' }] } : draft;
    }, true);
    try {
      // When / Then
      const result = await generateSolution(job, [], [], { client: api.client, knowledgeLoader: async () => libraryFixture });
      expect(result.reviewIssues).toContain('1번 S01 단계 수식을 확인한다.');
      expect(result.result.questions.map(question => question.number)).toEqual(['1', '2', '3', '4']);
      expect(api.calls.filter((call) => call.stage === 'solution_draft').map(call => call.numbers)).toEqual([['1', '2', '3'], ['1', '2', '3'], ['4']]);
      expect(api.calls.filter((call) => call.stage === 'student_math_review').map(call => call.numbers)).toEqual([['1', '2', '3'], ['4']]);
    } finally { await api.close(); }
  });
});
