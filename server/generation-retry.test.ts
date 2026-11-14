import { createServer } from 'node:http';
import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateSolution } from './generation.ts';
import { generatedFixture, jobFixture, libraryFixture, readingFixture } from './generation-fixtures.ts';
import { GeneratedResultSchema } from './generation-schemas.ts';

const RequestSchema = z.object({ model: z.string(), text: z.object({ format: z.object({ name: z.string() }) }), input: z.unknown() });
type RetryScenario = { readonly corrected: boolean; readonly check: 'source' | 'math' | 'meta' | 'latex' };
const scenarios: readonly RetryScenario[] = [
  { corrected: true, check: 'source' }, { corrected: false, check: 'source' },
  { corrected: true, check: 'math' }, { corrected: false, check: 'math' },
  { corrected: true, check: 'meta' }, { corrected: false, check: 'meta' },
  { corrected: true, check: 'latex' }, { corrected: false, check: 'latex' },
];

describe('bounded supplement writer correction', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(scenarios)('uses one $check correction and retains the draft (corrected $corrected)', async ({ corrected, check }) => {
    const baseModel = 'gpt-6-luna';
    vi.stubEnv('OPENAI_MODEL', baseModel);
    let reads = 0;
    let writes = 0;
    let reviews = 0;
    const requests: unknown[] = [];
    const models: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const parsed = RequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      requests.push(parsed.input);
      models.push(parsed.model);
      const isReading = parsed.text.format.name === 'exam_reading';
      const isReview = parsed.text.format.name === 'student_math_review';
      if (isReading) reads += 1;
      else if (isReview) reviews += 1;
      else writes += 1;
      const generated = generatedFixture();
      const question = generated.questions[0];
      const step = question?.steps[0];
      if (!question || !step) throw new Error('Missing fixture step.');
      if (check === 'math' && corrected && writes > 1) question.answer = 'unrelated answer corruption';
      const incorrect = writes <= 1 || !corrected;
      if (check === 'source' && incorrect) step.explanation = 'h(x)=x^2로 놓고 계산합니다.';
      if (check === 'meta' && incorrect) step.explanation = '사진의 미분 결과를 이용합니다.';
      if (check === 'latex' && incorrect) step.explanation = '\\(e-\text{−}0=e\\)';
      if (check === 'math' && incorrect) step.booklet = {
        group: null, equationRole: null, keyPhrases: null, equationNote: '상수항은 미분한 뒤에도 그대로 남습니다.', takeaway: null,
        referenceTip: null, termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null,
      };
      const reviewIssues = check === 'math' && incorrect ? ['1번 S01의 수식 주석에서 상수항의 미분을 잘못 설명했습니다.'] : [];
      const output = isReading ? readingFixture : isReview ? { issues: reviewIssues } : generated;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `resp_${requests.length}`, object: 'response', created_at: 0, status: 'completed', model: parsed.model,
        error: null, incomplete_details: null,
        service_tier: 'default', usage: { input_tokens: 2000, input_tokens_details: { cached_tokens: 400, cache_write_tokens: 1200 }, output_tokens: 300, total_tokens: 2300 },
        output: [{ id: `msg_${requests.length}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local test server did not open a port.');
    const client = new OpenAI({ apiKey: 'test-only', baseURL: `http://127.0.0.1:${address.port}/v1`, maxRetries: 0 });
    try {
      const diagnostic = { source: '원문에 없는 함수 h', math: '수식 주석에서 상수항의 미분', meta: '메모·제작 서술', latex: 'LaTeX 표기가 손상' };
      const onApiCost = vi.fn();
      const operation = generateSolution({ ...jobFixture, mode: 'supplement' }, [], [], { client, onApiCost, knowledgeLoader: async () => libraryFixture });
      const result = await operation;
      expect(result).toMatchObject({ result: { questions: [{ answer: '2x' }] }, model: baseModel });
      if (corrected) expect(result.reviewIssues).toBeUndefined();
      else expect(result.reviewIssues).toEqual([expect.stringContaining(diagnostic[check])]);
      const expectedReviews = check === 'math' ? 2 : corrected ? 1 : 0;
      expect(reads).toBe(1);
      expect(writes).toBe(2);
      expect(reviews).toBe(expectedReviews);
      expect(onApiCost.mock.calls.map(([phase]) => phase)).toEqual(['reading', ...Array.from({ length: 2 + expectedReviews }, () => 'question')]);
      expect(onApiCost.mock.calls[0]?.[1]).toMatchObject({ requests: 1, inputTokens: 2000, cachedInputTokens: 400, outputTokens: 300 });
      expect(models).toEqual(Array.from({ length: 3 + expectedReviews }, () => baseModel));
      if (check === 'math' && corrected) expect(JSON.stringify(requests.at(-1))).not.toContain('unrelated answer corruption');
      {
        const requestIndex = check === 'math' ? 3 : 2;
        expect(JSON.stringify(requests[requestIndex])).toContain(diagnostic[check]);
        if (check === 'source') expect(JSON.stringify(requests[requestIndex])).not.toContain('수정 대상은 1번 S01');
        else expect(JSON.stringify(requests[requestIndex])).toContain('수정 대상은 1번 S01');
        const retryInput = z.array(z.object({ role: z.string(), content: z.unknown() })).parse(requests[requestIndex]);
        expect(retryInput.find((message) => message.role === 'system')?.content).toContain('# 손해설 제작 프로젝트 v1');
        const context = retryInput.find((message) => message.role === 'user' && typeof message.content === 'string');
        if (!context || typeof context.content !== 'string') throw new Error('Missing previous generated draft context.');
        const previous = z.object({ sourceKind: z.literal('generated_draft_not_original'), previousStudentDraft: GeneratedResultSchema, correctionIssues: z.array(z.string()) }).parse(JSON.parse(context.content));
        expect(previous.previousStudentDraft.questions[0]?.number).toBe('1');
        expect(previous.correctionIssues.some((issue) => issue.includes(diagnostic[check]))).toBe(true);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
