import type { Job } from '../shared/contracts.ts';
import type { PdfAsset } from './pdf-template.ts';
import { AppError } from './errors.ts';

const allowedSourceTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export function isSingleQuestionSource(job: Job): boolean {
  return job.result?.questions.length === 1 && (job.progress?.questionNumbers.length ?? 1) === 1;
}

export function validateOriginalProblems(job: Job): void {
  for (const original of job.originalProblems ?? []) {
    const file = job.files.find(file => file.id === original.fileId);
    if (!file || file.role !== 'exam' || !allowedSourceTypes.has(file.mimeType)) {
      throw new AppError(400, '문제 원본은 이 작업에 첨부한 시험지 PDF 또는 이미지에서 지정해 주세요.');
    }
    if (file.mimeType !== 'application/pdf' && original.page !== 1) {
      throw new AppError(400, '이미지 문제 원본의 쪽 번호는 1이어야 합니다.');
    }
    const numbers = job.progress?.questionNumbers ?? job.result?.questions.map(question => question.number);
    if (numbers && numbers.filter(number => number === original.questionNumber).length !== 1) {
      throw new AppError(400, '문제 원본과 연결할 문항 번호를 결과에서 하나만 찾을 수 있어야 합니다.');
    }
  }
}

export function originalProblemTex(job: Job, number: string, assets: readonly PdfAsset[], stackedHeight?: number): string | undefined {
  const original = job.originalProblems?.find(original => original.questionNumber === number);
  if (!original) return undefined;
  const asset = assets.find(asset => asset.sourceFileIds.includes(original.fileId));
  if (!asset || asset.role === 'handwriting') {
    throw new AppError(400, '연결한 문제 원본 첨부를 PDF에서 찾지 못했습니다. 원본 연결을 확인해 주세요.');
  }
  const page = asset.mimeType === 'application/pdf' ? `page=${original.page},` : '';
  const trim = original.trim.map(value => `${value}bp`).join(' ');
  const width = `${original.widthBp}bp`;
  const size = stackedHeight === undefined ? `width=${width}`
    : String.raw`width=\dimexpr\ifdim${width}>\linewidth\linewidth\else${width}\fi\relax,height=${stackedHeight}\textheight,keepaspectratio`;
  return String.raw`\includegraphics[${page}trim=${trim},clip,${size}]{${asset.localName}}`;
}
