import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Job, SourceFile } from '../shared/contracts.ts';
import { MAX_JOB_INSTRUCTION_LENGTH, ModeSchema } from '../shared/contracts.ts';
import { DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import { getDefaultDesignReference } from './design-default.ts';
import { AppError } from './errors.ts';
import type { Store } from './store.ts';

const FormSchema = z.object({
  title: z.string().trim().min(1).max(160), subject: z.string().trim().min(1).max(80), mode: ModeSchema,
  inputText: z.string().max(60000), teacherText: z.string().max(60000), instruction: z.string().max(MAX_JOB_INSTRUCTION_LENGTH),
});

export function fileType(bytes: Buffer): { readonly mimeType: string; readonly extension: string } {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return { mimeType: 'application/pdf', extension: '.pdf' };
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mimeType: 'image/png', extension: '.png' };
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mimeType: 'image/jpeg', extension: '.jpg' };
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mimeType: 'image/webp', extension: '.webp' };
  throw new AppError(415, 'PDF, JPG, PNG, WebP 파일만 올릴 수 있습니다. 파일 내용을 확인해주세요.');
}

function filesFor(form: FormData, field: string): File[] {
  const values = form.getAll(field);
  if (values.some((value) => !(value instanceof File))) throw new AppError(400, '첨부파일 형식이 올바르지 않습니다.');
  return values.filter((value): value is File => value instanceof File && value.size > 0);
}

export async function createJob(form: FormData, store: Store): Promise<Job> {
  const data = FormSchema.parse({
    title: form.get('title') || '새 풀이', subject: form.get('subject') || '미적1', mode: form.get('mode') || 'solve',
    inputText: form.get('inputText') || '', teacherText: form.get('teacherText') || '', instruction: form.get('instruction') || '',
  });
  const exam = filesFor(form, 'examFiles');
  const handwriting = filesFor(form, 'solutionFiles');
  const files = [...exam.map((file) => ({ file, role: 'exam' as const })), ...handwriting.map((file) => ({ file, role: 'handwriting' as const }))];
  if (files.length > 4 || files.reduce((total, item) => total + item.file.size, 0) > 30 * 1024 * 1024) throw new AppError(413, '첨부는 최대 4개, 합계 30MB까지 가능합니다.');
  if (!exam.length && !data.inputText.trim()) throw new AppError(400, '시험지 파일이나 문제 내용을 입력해주세요.');
  if (data.mode === 'supplement' && !handwriting.length && !data.teacherText.trim()) throw new AppError(400, '손풀이 파일이나 원래 풀이 내용을 입력해주세요.');
  const prepared = await Promise.all(files.map(async ({ file, role }) => {
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = fileType(bytes);
    const id = randomUUID();
    const name = (file.name.replaceAll('\\', '/').split('/').pop() || '첨부파일').replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 180);
    const metadata: SourceFile = { id, name, mimeType: type.mimeType, size: bytes.length, role, url: `/api/files/${id}` };
    return { metadata, bytes, diskPath: path.join(store.uploadsDir, id + type.extension) };
  }));
  const id = randomUUID();
  const now = new Date().toISOString();
  const design = getDefaultDesignReference(store);
  const job: Job = {
    id, ...data, status: 'draft', createdAt: now, updatedAt: now, files: prepared.map((item) => item.metadata),
    reviewNote: '', result: null, error: null, model: null,
    ...(design ? { initialDesign: { referenceId: design.id, title: design.title, curveColor: design.curveColor } } : {}),
    pdfDesign: { ...DEFAULT_PDF_DESIGN, ...design?.pdfDesign, template: 'baeksin-v16', sourceLayout: 'stacked-reference' },
  };
  const written: string[] = [];
  try {
    for (const file of prepared) { await writeFile(file.diskPath, file.bytes, { flag: 'wx' }); written.push(file.diskPath); }
    store.saveJob(job, 'created');
    for (const file of prepared) store.addFile(file.metadata, id, file.diskPath);
  } catch (error) {
    await Promise.all(written.map((file) => unlink(file)));
    throw error;
  }
  return job;
}
