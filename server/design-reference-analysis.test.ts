import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { analyzeDesignReference } from './design-reference-analysis.ts';

const wireSchema = z.object({
  store: z.literal(false),
  input: z.array(z.object({ role: z.string(), content: z.unknown() })),
});

function mockClient(output: unknown, record: (body: unknown) => void = () => {}) {
  return new OpenAI({
    apiKey: 'test-only', maxRetries: 0,
    fetch: async (input, init) => {
      record(await new Request(input, init).json());
      return Response.json({
        id: 'resp_test', object: 'response', created_at: 0, status: 'completed', model: 'local-test',
        error: null, incomplete_details: null,
        output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      });
    },
  });
}

const source = { filename: 'layout.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.5') };

describe('design reference analysis', () => {
  it('returns supported suggestions after sending only the selected PDF', async () => {
    const expected = { note: '넓은 바깥 여백이 보입니다.', pdfDesign: { fontSize: 12, margins: 'wide', stepLayout: 'flow' }, curveColor: null };
    const requests: unknown[] = [];
    const result = await analyzeDesignReference(source, { client: mockClient(expected, (body) => requests.push(body)) });

    expect(result).toEqual(expected);
    expect(requests).toHaveLength(1);
    expect(wireSchema.parse(requests[0]).input.find((item) => item.role === 'user')?.content).toEqual([
      { type: 'input_file', filename: 'layout.pdf', file_data: `data:application/pdf;base64,${source.bytes.toString('base64')}` },
    ]);
  });

  it('preserves an unknown PDF suggestion when the selected reference is an image', async () => {
    const requests: unknown[] = [];
    const image = { ...source, filename: 'chart.png', mimeType: 'image/png' };
    const expected = { note: '파란 곡선 하나가 강조됩니다.', pdfDesign: null, curveColor: 'blue' };
    const result = await analyzeDesignReference(image, { client: mockClient(expected, (body) => requests.push(body)) });

    expect(result).toEqual(expected);
    expect(wireSchema.parse(requests[0]).input.find((item) => item.role === 'user')?.content).toEqual([
      { type: 'input_image', image_url: `data:image/png;base64,${source.bytes.toString('base64')}`, detail: 'high' },
    ]);
  });

  it('rejects unsupported model output without exposing its text', async () => {
    const invalid = { note: '모델에서 반환한 내용', pdfDesign: null, curveColor: 'neon' };
    await expect(analyzeDesignReference(source, { client: mockClient(invalid) })).rejects.toMatchObject({ status: 503 });
  });

  it('rejects oversized attachments before an outbound request', async () => {
    const requests: unknown[] = [];
    const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    await expect(analyzeDesignReference({ ...source, bytes }, { client: mockClient(null, (body) => requests.push(body)) }))
      .rejects.toMatchObject({ status: 413 });
    expect(requests).toHaveLength(0);
  });
});
