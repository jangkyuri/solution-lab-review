import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobSchema } from '../shared/contracts.ts';
import type { Job } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { renderFigureRecipe } from './figure-recipe.ts';
import type { FigureRecipeRender } from './figure-recipe.ts';
import { renderGraph } from './math-engine.ts';
import { bookletNativeGraphWidth, bookletInset } from './pdf-booklet-graphs.ts';
import { renderBookletGraphTex } from './pdf-graph-native.ts';
import { compilePdf, runPdfProcess, verifyPdf } from './pdf-runtime.ts';
import { pdfFilename } from './pdf-safety.ts';
import { renderPdfTex } from './pdf-template.ts';
import { DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import { prepareSourcePanels, stagePdfAttachments } from './pdf-staging.ts';
import { isSingleQuestionSource, validateOriginalProblems } from './pdf-originals.ts';
import { usesPairedHandSolutionPdf } from './pdf-paired-hand-solution.ts';
import type { PdfPurpose } from './pdf-paired-hand-solution.ts';

export type PdfSourceFile = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly role: 'exam' | 'handwriting';
  readonly diskPath: string;
};
export type PdfOutput = { readonly path: string; readonly filename: string; readonly pageCount: number };
type PdfPreviewPage = { readonly number: number; readonly jpegBase64: string };
type PdfPreview = { readonly pdfBase64: string; readonly pageCount: number; readonly pages: readonly PdfPreviewPage[] };
type FigureRecipeReceipt = Omit<FigureRecipeRender, 'path'> & { readonly questionNumber: string; readonly stepId: string; readonly stepNumber: number };
const defaultOutput = path.resolve(fileURLToPath(new URL('../data/exports/', import.meta.url)));
const maxPreviewPages = 8;
const maxPreviewDimension = 1300;

async function removePdfDirectory(directory: string, prefix: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new AppError(500, 'PDF 임시 폴더 경로를 확인하지 못했습니다.');
  }
  await rm(resolved, { recursive: true, force: true });
}

async function outputVersion(directory: string): Promise<number> {
  const versions = (await readdir(directory)).map((file) => Number(file.match(/_v(\d+)_02정답해설\.pdf$/u)?.[1] ?? 0));
  return Math.max(0, ...versions) + 1;
}

export async function buildJobPdf(input: Job, files: readonly PdfSourceFile[] = [], outputDir = defaultOutput): Promise<PdfOutput> {
  return buildPdf(input, files, { outputDir, purpose: 'export' });
}

async function buildPdf(input: Job, files: readonly PdfSourceFile[], options: { readonly outputDir: string; readonly purpose: PdfPurpose }): Promise<PdfOutput> {
  const job = JobSchema.parse(input);
  validateOriginalProblems(job);
  if (job.result === null || job.result.questions.length === 0 || job.status === 'running') throw new AppError(409, '내보낼 풀이 결과가 있어야 합니다.');
  if (job.result.questions.length > 40 || job.result.questions.reduce((sum, question) => sum + question.steps.length, 0) > 200) throw new AppError(413, '내보낼 문항을 나누어 주세요. 한 번에 40문항·200단계까지 가능합니다.');
  const stage = await mkdtemp(path.join(tmpdir(), 'solution-lab-pdf-'));
  try {
    await mkdir(path.join(stage, 'build'));
    const design = job.pdfDesign ?? DEFAULT_PDF_DESIGN;
    const paired = usesPairedHandSolutionPdf(job, options.purpose);
    const attachments = await stagePdfAttachments(files, stage, {
      trimCombinedImage: design.sourceLayout === 'stacked-reference' && isSingleQuestionSource(job) && !job.originalProblems?.length,
    });
    const activeNumbers = new Set(job.result.questions.map(question => question.number));
    const assets = design.template === 'baeksin-v16' && design.sourceLayout === 'stacked-reference' && job.mode === 'supplement' && !paired
      ? await prepareSourcePanels(attachments, (job.originalProblems ?? []).filter(original => activeNumbers.has(original.questionNumber)), stage) : attachments;
    const graphs = new Map<string, string>();
    const figureReceipts: FigureRecipeReceipt[] = [];
    for (const [questionIndex, question] of job.result.questions.entries()) {
      for (const [stepIndex, step] of question.steps.entries()) {
        const key = `${questionIndex}-${stepIndex}`;
        if (step.figureRecipe !== null && step.figureRecipe !== undefined) {
          const name = `graph-${key}.png`;
          const { bytes, labels, sha256, recipe_sha256 } = await renderFigureRecipe(step.figureRecipe, path.join(stage, name));
          figureReceipts.push({ questionNumber: question.number, stepId: step.id, stepNumber: stepIndex + 1, bytes, labels, sha256, recipe_sha256 });
          graphs.set(key, name);
          continue;
        }
        if (step.graph === null) continue;
        const style = design.template === 'baeksin-v16' || paired ? 'baeksin' : 'standard';
        const name = `graph-${questionIndex}-${stepIndex}.${style === 'baeksin' ? 'tex' : 'pdf'}`;
        if (style === 'baeksin') {
          const inset = await bookletInset(step.graph, step.booklet?.zoom);
          const linkOptions = step.booklet?.graphLinks ? { graphLinks: step.booklet.graphLinks } : {};
          await writeFile(path.join(stage, name), renderBookletGraphTex(step.graph, inset
            ? { width: 250, ...linkOptions, highlight: { xMin: inset.xMin, xMax: inset.xMax, yMin: inset.yMin, yMax: inset.yMax } }
            : { width: paired ? 242 : bookletNativeGraphWidth(step.booklet, design.sourceLayout === 'stacked-reference'), ...linkOptions }), 'utf8');
          if (inset) {
            const insetName = `graph-${questionIndex}-${stepIndex}-zoom.tex`;
            await writeFile(path.join(stage, insetName), renderBookletGraphTex(inset, { width: 175 }), 'utf8');
            graphs.set(`${key}:zoom`, insetName);
          }
        } else await renderGraph(step.graph, path.join(stage, name), 'pdf', style);
        graphs.set(key, name);
      }
    }
    await writeFile(path.join(stage, 'main.tex'), renderPdfTex(job, assets, graphs, options.purpose), 'utf8');
    const pageCount = await compilePdf(stage);
    const source = path.join(stage, 'build', 'main.pdf');
    await verifyPdf(source);
    const receipt = options.purpose === 'export' && figureReceipts.length > 0 ? path.join(stage, 'figure-recipes.json') : null;
    if (receipt) await writeFile(receipt, `${JSON.stringify({ figures: figureReceipts }, null, 2)}\n`, 'utf8');
    const jobFolder = createHash('sha256').update(job.id).digest('hex').slice(0, 20);
    const directory = path.resolve(options.outputDir, jobFolder);
    await mkdir(directory, { recursive: true });
    let version = await outputVersion(directory);
    while (version < 10_000) {
      const filename = pdfFilename(`${job.subject}_${job.title}`, version);
      const destination = path.join(directory, filename);
      let copied = false;
      try {
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        copied = true;
        await verifyPdf(destination);
        if (receipt) await copyFile(receipt, destination.replace(/\.pdf$/u, '.figure-recipes.json'), constants.COPYFILE_EXCL);
        return { path: destination, filename, pageCount };
      } catch (error) {
        if (copied) await unlink(destination);
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') { version += 1; continue; }
        throw error;
      }
    }
    throw new AppError(409, '이 작업의 PDF 버전 수가 한도를 넘었습니다. 새 작업으로 내보내 주세요.');
  } finally {
    await removePdfDirectory(stage, 'solution-lab-pdf-');
  }
}

async function renderPreviewPages(output: PdfOutput, directory: string): Promise<readonly PdfPreviewPage[]> {
  const pageCount = Math.min(output.pageCount, maxPreviewPages);
  const executable = process.env['SOLUTION_LAB_PDFTOPPM'] || 'pdftoppm';
  await runPdfProcess(executable, [
    '-f', '1', '-l', String(pageCount), '-scale-to', String(maxPreviewDimension),
    '-jpeg', '-jpegopt', 'quality=86', output.path, 'page',
  ], directory, 30_000);
  const images = (await readdir(directory)).flatMap((name) => {
    const page = /^page-(\d+)\.jpg$/u.exec(name)?.[1];
    return page === undefined ? [] : [{ name, number: Number(page) }];
  }).sort((first, second) => first.number - second.number);
  if (images.length !== pageCount || images.some(({ number }, index) => number !== index + 1)) {
    throw new AppError(503, 'PDF 미리보기 쪽을 확인하지 못했습니다. 다시 시도해 주세요.');
  }
  return Promise.all(images.map(async ({ name, number }) => {
    const image = await readFile(path.join(directory, name));
    if (image[0] !== 255 || image[1] !== 216 || image[2] !== 255) {
      throw new AppError(503, 'PDF 미리보기 이미지를 읽지 못했습니다. 다시 시도해 주세요.');
    }
    return { number, jpegBase64: image.toString('base64') };
  }));
}

export function previewJobPdf(job: Job, files: readonly PdfSourceFile[]): Promise<Buffer<ArrayBuffer>>;
export function previewJobPdf(job: Job, files: readonly PdfSourceFile[], format: 'images'): Promise<PdfPreview>;
export async function previewJobPdf(job: Job, files: readonly PdfSourceFile[], format?: 'images'): Promise<Buffer<ArrayBuffer> | PdfPreview> {
  const prefix = 'solution-lab-pdf-preview-';
  const outputDirectory = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    const output = await buildPdf(job, files, { outputDir: outputDirectory, purpose: 'review' });
    const pdf = await readFile(output.path);
    if (format === undefined) return pdf;
    const pages = await renderPreviewPages(output, outputDirectory);
    return { pdfBase64: pdf.toString('base64'), pageCount: output.pageCount, pages };
  } finally {
    await removePdfDirectory(outputDirectory, prefix);
  }
}
