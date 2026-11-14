import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { ResponseInputContent } from 'openai/resources/responses/responses';
import type { Job, OriginalProblem } from '../shared/contracts.ts';
import type { Reading } from './generation-schemas.ts';
import type { StoredFile } from './store.ts';
import { AppError } from './errors.ts';
import { pythonExecutable } from './math-engine.ts';
import { runPdfProcess } from './pdf-runtime.ts';

const attachmentLimit = 30 * 1024 * 1024;

function validateAttachments(job: Job, files: readonly StoredFile[]): void {
  if (files.length > 4 || files.some((file) => file.jobId !== job.id)) throw new AppError(400, '이 작업에 속한 첨부파일을 확인해주세요.');
}

function roleFor(job: Job, file: StoredFile): StoredFile['role'] | 'reference' {
  return job.mode === 'solve' && file.role === 'handwriting' ? 'reference' : file.role;
}

export function encodeAttachment(name: string, mimeType: string, bytes: Buffer): ResponseInputContent {
  switch (mimeType) {
    case 'application/pdf':
      return { type: 'input_file', filename: name, file_data: `data:application/pdf;base64,${bytes.toString('base64')}` };
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      return { type: 'input_image', image_url: `data:${mimeType};base64,${bytes.toString('base64')}`, detail: 'high' };
    default:
      throw new AppError(415, 'PDF, JPG, PNG, WebP 자료만 판독할 수 있습니다.');
  }
}

export async function buildReadingInput(job: Job, files: readonly StoredFile[]): Promise<ResponseInputContent[]> {
  validateAttachments(job, files);
  const loaded = await Promise.all(files.map(async (file) => ({ file, bytes: await readFile(file.diskPath) })));
  if (loaded.reduce((sum, item) => sum + item.bytes.length, 0) > attachmentLimit) throw new AppError(413, '판독할 첨부파일의 합계는 30MB까지 가능합니다.');
  const content: ResponseInputContent[] = [{ type: 'input_text', text: JSON.stringify({
    task: { mode: job.mode, subject: job.subject, userInstruction: job.instruction },
    suppliedProblemText: job.inputText,
    suppliedHandwritingText: job.mode === 'supplement' ? job.teacherText : '',
    attachments: loaded.map(({ file }) => ({ name: file.name, role: roleFor(job, file) })),
  }) }];
  for (const { file, bytes } of loaded) {
    content.push({ type: 'input_text', text: JSON.stringify({ attachmentRole: roleFor(job, file), attachmentName: file.name }) });
    content.push(encodeAttachment(file.name, file.mimeType, bytes));
  }
  return content;
}

const numberNote = /(?:문항|문제|발문|쪽|페이지|인쇄(?:된)?)\s*번호|쪽수|(?:question|printed|item|page)\s+number/iu;
const mathDetail = /부호|기호|등호|분모|분자|절댓값|지수|수치|계수|수식|함수식|숫자|변수|조건|보기|선지|그래프|그림|음영|화살표|좌표|sign|symbol|exponent|condition|choice|diagram|graph|coordinate/iu;
const handwritingDetail = /손\s*풀이|손\s*글씨|손\s*해설|필기|필획|\bS\d+\b|handwrit|handwritten/iu;
const examDetail = /시험지|문제지|문제\s*(?:의|원본|본문|조건|그래프)|발문|인쇄|선지|exam|printed|statement/iu;
const visualDetail = /그래프|그림|음영|화살표|좌표|교점|보조선|graph|diagram|arrow|shading/iu;
const sourceUncertainty = /불확실|불명확|흐릿|흐려|모호|미확인|잘렸|구별하기 어렵|판독.{0,6}(?:어렵|안 됨|되지 않)|읽기 어렵|읽을 수 없|보이지 않|확인할 수 없|확정할 수 없|unclear|illegible|ambiguous/iu;

function questionEvidenceRoles(question: Reading['questions'][number], mode: Job['mode']): Set<StoredFile['role']> {
  const roles = new Set<StoredFile['role']>();
  if (!question.problemText.trim()) roles.add('exam');
  if (mode === 'supplement' && question.handwritingStatus === 'unreadable') roles.add('handwriting');
  const notes = [...question.uncertainties, ...question.visualObservations.filter(note => sourceUncertainty.test(note))];
  for (const note of notes) {
    if (numberNote.test(note) && !mathDetail.test(note)) continue;
    if (handwritingDetail.test(note)) {
      if (mode === 'supplement') roles.add('handwriting');
      if (examDetail.test(note)) roles.add('exam');
    } else if (examDetail.test(note)) {
      roles.add('exam');
    } else if (mathDetail.test(note) || sourceUncertainty.test(note)) {
      roles.add(visualDetail.test(note) && mode === 'supplement' && question.handwritingStatus === 'read' ? 'handwriting' : 'exam');
    }
  }
  return roles;
}

function filesForQuestion(files: readonly StoredFile[], number: string): readonly StoredFile[] {
  const numbers = files.map(({ name, mimeType }) => {
    const stem = name.slice(0, name.length - extname(name).length);
    return mimeType.startsWith('image/') ? /(?:^|[\s_.(-])(\d+)\s*번\s*\)?$/u.exec(stem)?.[1] : undefined;
  });
  const index = numbers.indexOf(number);
  const match = files[index];
  return match && !numbers.includes(undefined) && new Set(numbers).size === files.length ? [match] : files;
}

const cropScript = `from PIL import Image
import math, sys
source, destination, left, bottom, right, top = sys.argv[1:]
left, bottom, right, top = [math.floor(2 * float(edge)) for edge in (left, bottom, right, top)]
with Image.open(source) as image:
    box = (left, top, image.width - right, image.height - bottom)
    if box[0] >= box[2] or box[1] >= box[3]:
        raise ValueError("invalid question crop")
    image.crop(box).save(destination, "PNG")`;

async function renderQuestionCrop(file: StoredFile, original: OriginalProblem): Promise<Buffer | null> {
  const directory = await mkdtemp(join(tmpdir(), 'solution-lab-source-crop-'));
  const pagePath = join(directory, 'page.png');
  const cropPath = join(directory, 'question.png');
  try {
    const executable = process.env['SOLUTION_LAB_PDFTOPPM'] || 'pdftoppm';
    const page = String(original.page);
    await runPdfProcess(executable,
      ['-f', page, '-l', page, '-singlefile', '-r', '144', '-cropbox', '-png', file.diskPath, 'page'], directory, 15_000);
    if (original.trim.every(edge => edge === 0)) return await readFile(pagePath);
    await runPdfProcess(pythonExecutable(), ['-I', '-c', cropScript, pagePath, cropPath, ...original.trim.map(String)], directory, 15_000);
    return await readFile(cropPath);
  } catch {
    return null;
  } finally {
    await Promise.all([unlink(pagePath).catch(() => undefined), unlink(cropPath).catch(() => undefined)]);
    await rmdir(directory).catch(() => undefined);
  }
}

export async function buildWriterEvidence(
  job: Job,
  files: readonly StoredFile[],
  reading: Reading,
  options: { readonly correction?: boolean } = {},
): Promise<ResponseInputContent[]> {
  validateAttachments(job, files);
  const fullFiles = new Set<StoredFile>();
  const mapped = new Map<StoredFile, OriginalProblem[]>();
  if (job.mode === 'solve' && !options.correction) {
    for (const file of files.filter(file => file.role === 'handwriting')) fullFiles.add(file);
  }
  for (const question of reading.questions) {
    for (const role of questionEvidenceRoles(question, job.mode)) {
      const candidates = files.filter(file => file.role === role);
      const original = role === 'exam' ? job.originalProblems?.find(item => item.questionNumber === question.number) : undefined;
      const source = original && candidates.find(file => file.id === original.fileId);
      if (original && source?.mimeType === 'application/pdf') {
        mapped.set(source, [...(mapped.get(source) ?? []), original]);
      } else {
        for (const file of source ? [source] : filesForQuestion(candidates, question.number)) fullFiles.add(file);
      }
    }
  }

  const content: ResponseInputContent[] = [];
  let total = 0;
  const addAttachment = (file: StoredFile, name: string, mimeType: string, bytes: Buffer, questionNumber?: string): void => {
    total += bytes.length;
    if (total > attachmentLimit) throw new AppError(413, '판독할 첨부파일의 합계는 30MB까지 가능합니다.');
    content.push({ type: 'input_text', text: JSON.stringify({ attachmentRole: roleFor(job, file), attachmentName: name, questionNumber }) });
    content.push(encodeAttachment(name, mimeType, bytes));
  };
  for (const [file, originals] of mapped) {
    if (fullFiles.has(file)) continue;
    const crops: { readonly number: string; readonly bytes: Buffer }[] = [];
    for (const original of originals) {
      const bytes = await renderQuestionCrop(file, original);
      if (bytes === null || bytes.length > attachmentLimit) {
        fullFiles.add(file);
        break;
      }
      crops.push({ number: original.questionNumber, bytes });
    }
    if (fullFiles.has(file)) continue;
    for (const { number, bytes } of crops) addAttachment(file, `${file.name} · ${number}번.png`, 'image/png', bytes, number);
  }
  for (const file of fullFiles) addAttachment(file, file.name, file.mimeType, await readFile(file.diskPath));
  return content;
}

type Candidate = { readonly sampleId: string; readonly sourceId: string; readonly title: string; readonly centralArgument: string };

export function selectMethodEvidence<T extends Candidate>(candidates: readonly T[], terms: readonly string[], limit = 3): T[] {
  const tokens = [...new Set(terms.flatMap((term) => term.toLocaleLowerCase('ko-KR').split(/[^\p{L}\p{N}]+/u)).filter((term) => term.length > 1))];
  const scored = candidates.filter((candidate) => /^P\d+$/u.test(candidate.sampleId)).map((candidate) => {
    const text = `${candidate.title} ${candidate.centralArgument}`.toLocaleLowerCase('ko-KR');
    return { candidate, score: tokens.reduce((sum, term) => sum + Number(text.includes(term)), 0) };
  });
  return scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.candidate.sampleId.localeCompare(b.candidate.sampleId)).slice(0, limit).map((item) => item.candidate);
}
