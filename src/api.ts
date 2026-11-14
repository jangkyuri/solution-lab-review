import ky, { HTTPError } from 'ky';
import { z } from 'zod';
import {
  BootstrapSchema, JobSchema, LibrarySchema,
} from '../shared/contracts';
import type { Job, SolutionResult } from '../shared/contracts';
import type { PdfDesign } from '../shared/pdf-design';
import { KnowledgeLibrarySchema } from '../shared/knowledge';

const client = ky.create({ prefix: '/api', timeout: 30_000, retry: 0 });
const errorSchema = z.object({ error: z.string() });
const PdfPreviewSchema = z.object({
  pdfBase64: z.string().min(1), pageCount: z.number().int().positive(),
  pages: z.array(z.object({ number: z.number().int().positive(), jpegBase64: z.string().min(1) })).min(1).max(8),
});
export type PdfPreviewPages = z.infer<typeof PdfPreviewSchema>['pages'];

export const api = {
  bootstrap: async (signal?: AbortSignal) => BootstrapSchema.parse(
    await client.get('bootstrap', signal ? { signal } : {}).json(),
  ),
  job: async (id: string, signal?: AbortSignal) => JobSchema.parse(
    await client.get(`jobs/${encodeURIComponent(id)}`, signal ? { signal } : {}).json(),
  ),
  create: async (body: FormData) => JobSchema.parse(await client.post('jobs', { body }).json()),
  run: async (id: string) => JobSchema.parse(await client.post(`jobs/${encodeURIComponent(id)}/run`).json()),
  next: async (id: string, completedCount: number) => JobSchema.parse(
    await client.post(`jobs/${encodeURIComponent(id)}/next`, { json: { completedCount } }).json(),
  ),
  completeReview: async (id: string, updatedAt: string) => JobSchema.parse(
    await client.post(`jobs/${encodeURIComponent(id)}/complete-review`, { json: { updatedAt } }).json(),
  ),
  retryFigure: async (id: string, updatedAt: string, questionNumber: string, stepId: string) => JobSchema.parse(
    await client.post(`jobs/${encodeURIComponent(id)}/retry-figure`, {
      json: { updatedAt, questionNumber, stepId }, timeout: 210_000,
    }).json(),
  ),
  save: async (id: string, result: SolutionResult | null, reviewNote: string | undefined, pdfDesign?: PdfDesign) => {
    const json = { ...(reviewNote === undefined ? {} : { reviewNote }), ...(result ? { result } : {}), ...(pdfDesign ? { pdfDesign } : {}) };
    return JobSchema.parse(await client.patch(`jobs/${encodeURIComponent(id)}`, { json }).json());
  },
  pdfPreview: async (id: string, result: SolutionResult | null, pdfDesign: PdfDesign, signal: AbortSignal) => PdfPreviewSchema.parse(
    await client.post(`jobs/${encodeURIComponent(id)}/pdf-preview`, {
      json: { pdfDesign, ...(result ? { result } : {}) },
      headers: { Accept: 'application/json' }, timeout: 180_000, signal,
    }).json(),
  ),
  approve: async (id: string) => JobSchema.parse(await client.post(`jobs/${encodeURIComponent(id)}/approve`).json()),
  library: async (q: string, subject: string, signal?: AbortSignal) => LibrarySchema.parse(
    await client.get('library', { searchParams: { q, subject }, ...(signal ? { signal } : {}) }).json(),
  ),
  knowledge: async (signal?: AbortSignal) => KnowledgeLibrarySchema.parse(await client.get('knowledge', signal ? { signal } : {}).json()),
  revisions: async (id: string, signal?: AbortSignal) => z.object({ revisions: z.array(z.object({ id: z.string(), createdAt: z.string(), reason: z.string(), job: JobSchema })) }).parse(
    await client.get(`jobs/${encodeURIComponent(id)}/revisions`, signal ? { signal } : {}).json(),
  ),
};

export async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    const body: unknown = await error.response.json().catch(() => null);
    const parsed = errorSchema.safeParse(body);
    return parsed.success ? parsed.data.error : `요청을 완료하지 못했습니다. (${error.response.status})`;
  }
  if (error instanceof Error) return error.message;
  return '요청을 완료하지 못했습니다. 다시 시도해주세요.';
}

export function jobDate(job: Job): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(job.updatedAt));
}

export const statusLabels = {
  draft: '준비됨', running: '풀이 작성 중', needs_review: '초안 검토 필요', awaiting_next: '다음 묶음 허용 대기',
  ready: '작성 완료', failed: '처리 실패', approved: '검토 완료',
} satisfies Record<Job['status'], string>;
