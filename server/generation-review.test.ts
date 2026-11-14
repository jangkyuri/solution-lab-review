import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generatedFixture, readingFixture } from './generation-fixtures.ts';
import { reviewGeneratedStudentText } from './generation-review.ts';

const WireSchema = z.object({ input: z.array(z.object({ role: z.string(), content: z.string() })) });
const MaterialSchema = z.object({
  sourceLimitations: z.array(z.string()), limitations: z.array(z.string()),
  questionScope: z.object({ questionNumbers: z.array(z.string()) }),
  studentDraft: z.array(z.object({ checks: z.unknown(), uncertainties: z.array(z.string()) })),
});

describe('independent student review material', () => {
  it('sends diagnostic certainty claims and limitations to the real SDK review request', async () => {
    // Given: certainty claims can appear outside the visible solution prose.
    const generated = generatedFixture();
    const question = generated.questions[0];
    if (!question) throw new Error('Missing fixture question.');
    question.checks.math = ['분자 오류를 확정했다.'];
    question.uncertainties = ['분자 판독은 아직 확정하지 못했다.'];
    generated.limitations = ['작은 필기가 흐리다.'];
    const reading = { ...readingFixture, limitations: ['원문 일부의 판독이 불확실하다.'] };
    const requests: unknown[] = [];
    const client = new OpenAI({
      apiKey: 'test-only', maxRetries: 0,
      fetch: async (input, init) => {
        requests.push(await new Request(input, init).json());
        return Response.json({
          id: 'resp_test', object: 'response', created_at: 0, status: 'completed', model: 'local-test',
          error: null, incomplete_details: null,
          output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ issues: [] }), annotations: [] }] }],
        });
      },
    });

    // When: the actual SDK serializes the review call through a local transport fake.
    await reviewGeneratedStudentText(client, {
      model: 'test-model', mode: 'supplement', reading, generated, userInstruction: '전체 4문항을 쪽 순서대로 보강',
    });

    // Then: the reviewer receives the claims needed to check uncertainty consistently.
    const messages = WireSchema.parse(requests[0]).input;
    const user = messages.find((message) => message.role === 'user');
    if (!user) throw new Error('Missing review material.');
    const material = MaterialSchema.parse(JSON.parse(user.content));
    expect(material.questionScope.questionNumbers).toEqual(reading.questions.map(source => source.number));
    const system = messages.find((message) => message.role === 'system')?.content;
    expect(system).toContain('범위 밖 문항이 초안에 없다는 이유로 누락을 보고하거나 추가 작성을 요구하지 않는다.');
    expect(system).toContain('판정에 필요한 선과 점이 실제 그래프에 빠져 있으면');
    expect(system).toContain('그림에 표시한 교점 수나 정답을 문장으로 반복하면 해당 단계에서 중복을 덜고');
    expect(material.studentDraft[0]?.checks).toEqual(question.checks);
    expect(material.studentDraft[0]?.uncertainties).toEqual(question.uncertainties);
    expect(material.limitations).toEqual(generated.limitations);
    expect(material.sourceLimitations).toEqual(reading.limitations);
  });
});
