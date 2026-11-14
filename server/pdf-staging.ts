import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OriginalProblem } from '../shared/contracts.ts';
import type { PdfSourceFile } from './pdf.ts';
import type { PdfAsset } from './pdf-template.ts';
import { AppError } from './errors.ts';
import { convertWebp, runPdfProcess } from './pdf-runtime.ts';
import { findSourceImageSplit, trimSourceImage } from './pdf-source-image.ts';

export async function stagePdfAttachments(files: readonly PdfSourceFile[], stage: string, options: { readonly trimCombinedImage: boolean }): Promise<readonly PdfAsset[]> {
  if (files.length > 4) throw new AppError(413, 'PDF에 넣을 원본 첨부는 최대 4개입니다.');
  const sources = await Promise.all(files.map(async (file) => ({ ...file, bytes: await readFile(file.diskPath) })));
  const assets: PdfAsset[] = [];
  const combinedIndexes = new Set<number>();
  for (const [index, file] of sources.entries()) {
    if (combinedIndexes.has(index)) continue;
    const { bytes } = file;
    const matches = sources.flatMap((other, otherIndex) =>
      other.mimeType === file.mimeType && other.bytes.equals(bytes) ? [{ index: otherIndex, role: other.role, id: other.id }] : []);
    const paired = matches.some((match) => match.role !== file.role);
    const role = paired ? 'exam_and_handwriting' : file.role;
    const sourceFileIds = paired ? matches.map(match => match.id) : [file.id];
    if (paired) for (const match of matches) combinedIndexes.add(match.index);
    const header = bytes.subarray(0, 8);
    let extension = '';
    if (file.mimeType === 'application/pdf' && header.subarray(0, 5).toString('ascii') === '%PDF-') extension = 'pdf';
    else if (file.mimeType === 'image/png' && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = 'png';
    else if (file.mimeType === 'image/jpeg' && header[0] === 255 && header[1] === 216 && header[2] === 255) extension = 'jpg';
    else if (file.mimeType === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') extension = 'webp';
    else throw new AppError(415, 'PDF 원본 파일 형식을 확인해 주세요.');
    const localName = `source-${index + 1}.${extension}`;
    await writeFile(path.join(stage, localName), bytes, { flag: 'wx' });
    if (extension === 'webp') {
      const pngName = `source-${index + 1}.png`;
      await convertWebp(path.join(stage, localName), path.join(stage, pngName), stage);
      assets.push({ localName: pngName, name: file.name, mimeType: 'image/png', role, sourceFileIds });
    } else assets.push({ localName, name: file.name, mimeType: file.mimeType, role, sourceFileIds });
  }
  const [asset] = assets;
  if (!options.trimCombinedImage || assets.length !== 1 || asset?.role !== 'exam_and_handwriting' || !asset.mimeType.startsWith('image/')) return assets;
  const croppedName = `${path.parse(asset.localName).name}-trimmed.png`;
  const imageSize = await trimSourceImage(path.join(stage, asset.localName), path.join(stage, croppedName), stage);
  return [{ ...asset, localName: croppedName, mimeType: 'image/png', imageSize }];
}

async function inspectPdfPage(name: string, pageNumber: number, stage: string) {
  const page = String(pageNumber);
  const prefix = `${path.parse(name).name}-page-${page}`;
  const info = await runPdfProcess(process.env['SOLUTION_LAB_PDFINFO'] || 'pdfinfo',
    ['-f', page, '-l', page, '-box', name], stage, 30_000);
  const box = /^Page\s+\d+\s+CropBox:\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/mu.exec(info.stdout);
  const rotation = /^Page\s+\d+\s+rot:\s+(\d+)/mu.exec(info.stdout)?.[1];
  if (!box || rotation !== '0') return null;
  const width = Number(box[3]) - Number(box[1]);
  const height = Number(box[4]) - Number(box[2]);
  if (!(width > 0 && height > 0) || Math.max(width, height) > 1500) return null;
  await runPdfProcess(process.env['SOLUTION_LAB_PDFTOPPM'] || 'pdftoppm',
    ['-f', page, '-l', page, '-singlefile', '-r', '144', '-cropbox', '-png', name, prefix], stage, 45_000);
  return { raster: path.join(stage, `${prefix}.png`), width, height };
}

export async function prepareSourcePanels(assets: readonly PdfAsset[], originals: readonly OriginalProblem[], stage: string): Promise<readonly PdfAsset[]> {
  return Promise.all(assets.map(async (asset): Promise<PdfAsset> => {
    if (asset.role !== 'exam_and_handwriting') return asset;
    if (asset.imageSize && assets.length === 1 && originals.length === 0) {
      const sourcePanels = ['hand-upper.png', 'hand-lower.png'] as const;
      const [upper, lower] = sourcePanels;
      const split = await findSourceImageSplit(path.join(stage, asset.localName), [0, 0, 0, 0], stage,
        [path.join(stage, upper), path.join(stage, lower)]);
      return split ? { ...asset, sourcePanels, sourcePanelRatio: split.width / Math.max(split.y, split.height - split.y) } : asset;
    }
    if (asset.mimeType !== 'application/pdf') return asset;
    const mappedSourceSplits = new Map<string, { pageHeight: number; seam: number; ratio: number }>();
    const pageImages = new Map<number, Awaited<ReturnType<typeof inspectPdfPage>>>();
    for (const original of originals.filter(item => asset.sourceFileIds.includes(item.fileId))) {
      if (!pageImages.has(original.page)) {
        const page = await inspectPdfPage(asset.localName, original.page, stage).catch((error: unknown) => {
          if (!(error instanceof AppError)) throw error;
          return null;
        });
        pageImages.set(original.page, page);
      }
      const page = pageImages.get(original.page);
      if (!page) continue;
      const [left, bottom, right, top] = original.trim;
      const width = page.width - left - right;
      if (width <= 0 || page.height - bottom - top < 1.15 * width) continue;
      const pixels = (bp: number) => Math.floor(bp * 2);
      const split = await findSourceImageSplit(page.raster, [pixels(left), pixels(bottom), pixels(right), pixels(top)], stage);
      if (!split) continue;
      const seam = split.y / 2;
      if (seam <= top || seam >= page.height - bottom) continue;
      const ratio = width / Math.max(seam - top, page.height - bottom - seam);
      mappedSourceSplits.set(original.questionNumber, { pageHeight: page.height, seam, ratio });
    }
    return { ...asset, mappedSourceSplits };
  }));
}

