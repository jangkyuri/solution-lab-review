import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runPdfProcess } from './pdf-runtime.ts';
import { stagePdfAttachments } from './pdf-staging.ts';
import { trimSourceImage } from './pdf-source-image.ts';

const python = path.resolve('python', '.venv', 'Scripts', 'python.exe');
const ImageInfoSchema = z.object({ width: z.number(), height: z.number(), faintPixel: z.array(z.number()) });

describe('source staging for a matched one-question image', () => {
  it('retains a short isolated final answer stroke far below the preceding handwriting', async () => {
    // Given: an answer 1 appears below a long empty gap after the previous working.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-source-final-answer-test-'));
    try {
      const source = path.join(directory, 'original.png');
      const destination = path.join(directory, 'trimmed.png');
      await runPdfProcess(python, ['-c', [
        'from PIL import Image, ImageDraw',
        'import sys',
        'with Image.new("RGB", (1000, 1000), "white") as image:',
        ' draw = ImageDraw.Draw(image)',
        ' draw.rectangle((100, 80, 900, 160), fill="black")',
        ' draw.line((130, 650, 750, 650), fill=(252,252,252), width=1)',
        ' draw.line((400, 800, 400, 817), fill="black", width=1)',
        ' image.save(sys.argv[1])',
      ].join('\n'), source], directory, 30_000);

      // When: outer whitespace is trimmed using the scan content.
      const size = await trimSourceImage(source, destination, directory);

      // Then: even the short final answer determines the lower edge of the crop.
      expect(size).toEqual({ width: 825, height: 762 });
      const pixel = await runPdfProcess(python, ['-c', [
        'from PIL import Image',
        'import json, sys',
        'with Image.open(sys.argv[1]) as image:',
        ' print(json.dumps(list(image.getpixel((312,749)))))',
      ].join('\n'), destination], directory, 30_000);
      expect(JSON.parse(pixel.stdout)).toEqual([0, 0, 0]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the combined scan untrimmed when an additional distinct attachment makes pairing ambiguous', async () => {
    // Given: an exact exam/handwriting pair plus another distinct source image.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-source-ambiguous-test-'));
    try {
      const source = path.join(directory, 'original.png');
      const extra = path.join(directory, 'extra.png');
      await runPdfProcess(python, ['-c', [
        'from PIL import Image, ImageDraw',
        'import sys',
        'with Image.new("RGB", (1000, 800), "white") as image:',
        ' ImageDraw.Draw(image).rectangle((100, 80, 900, 500), fill="black")',
        ' image.save(sys.argv[1])',
        'with Image.new("RGB", (50, 50), (60,93,114)) as image:',
        ' image.save(sys.argv[2])',
      ].join('\n'), source, extra], directory, 30_000);
      const files = [
        { id: 'exam', name: '문제와 손풀이.png', mimeType: 'image/png', role: 'exam', diskPath: source },
        { id: 'handwriting', name: '문제와 손풀이.png', mimeType: 'image/png', role: 'handwriting', diskPath: source },
        { id: 'extra', name: '다른 원본.png', mimeType: 'image/png', role: 'exam', diskPath: extra },
      ] as const;

      // When: one-question export asks staging to trim a possible combined source.
      const assets = await stagePdfAttachments(files, directory, { trimCombinedImage: true });

      // Then: the same exact-one-asset eligibility used by the renderer governs trimming.
      expect(assets).toHaveLength(2);
      for (const asset of assets) {
        const original = asset.role === 'exam_and_handwriting' ? source : extra;
        expect(asset.imageSize).toBeUndefined();
        expect(await readFile(path.join(directory, asset.localName))).toEqual(await readFile(original));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores distant scanner dust while retaining faint handwriting and a detached nearby sign', async () => {
    // Given: a worksheet whose meaningful marks end far above isolated edge dust.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-source-dust-test-'));
    try {
      const source = path.join(directory, 'original.png');
      const destination = path.join(directory, 'trimmed.png');
      await runPdfProcess(python, ['-c', [
        'from PIL import Image, ImageDraw',
        'import sys',
        'with Image.new("RGB", (1000, 1000), "white") as image:',
        ' draw = ImageDraw.Draw(image)',
        ' draw.rectangle((100, 80, 900, 160), fill="black")',
        ' draw.line((130, 650, 750, 650), fill=(252,252,252), width=1)',
        ' draw.rectangle((765, 665, 767, 667), fill=(248,248,248))',
        ' draw.rectangle((980, 980, 983, 983), fill="black")',
        ' draw.rectangle((20, 970, 30, 977), fill=(200,200,200))',
        ' image.save(sys.argv[1])',
      ].join('\n'), source], directory, 30_000);
      const before = await readFile(source);

      // When: only outer whitespace and distant small dust are excluded from the derivative.
      const size = await trimSourceImage(source, destination, directory);

      // Then: the printed problem and faint final marks fit in the crop, and original bytes are intact.
      expect(size).toEqual({ width: 825, height: 612 });
      expect(await readFile(source)).toEqual(before);
      const pixels = await runPdfProcess(python, ['-c', [
        'from PIL import Image',
        'import json, sys',
        'with Image.open(sys.argv[1]) as image:',
        ' print(json.dumps([list(image.getpixel((42,582))),list(image.getpixel((677,597))),list(image.getpixel((12,12)))]))',
      ].join('\n'), destination], directory, 30_000);
      expect(JSON.parse(pixels.stdout)).toEqual([[252, 252, 252], [248, 248, 248], [0, 0, 0]]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([true, false])('preserves original bytes and faint marks when trimming is %s', async (trimCombinedImage) => {
    // Given: an image with a printed problem at the top and a faint final handwriting line.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-source-stage-test-'));
    try {
      const source = path.join(directory, 'original.png');
      await runPdfProcess(python, ['-c', [
        'from PIL import Image, ImageDraw',
        'import sys',
        'with Image.new("RGB", (1000, 800), "white") as image:',
        ' draw = ImageDraw.Draw(image)',
        ' draw.rectangle((120, 100, 850, 180), fill="black")',
        ' draw.line((100, 650, 890, 650), fill=(252,252,252), width=1)',
        ' image.save(sys.argv[1])',
      ].join('\n'), source], directory, 30_000);
      const before = await readFile(source);
      const files = [
        { id: 'exam', name: '문제와 손풀이.png', mimeType: 'image/png', role: 'exam', diskPath: source },
        { id: 'handwriting', name: '문제와 손풀이.png', mimeType: 'image/png', role: 'handwriting', diskPath: source },
      ] as const;

      // When: the source pair is staged for the finished renderer.
      const assets = await stagePdfAttachments(files, directory, { trimCombinedImage });
      const asset = assets[0];
      if (!asset) throw new Error('Missing staged asset');

      // Then: exact source identity is retained and only the eligible staged derivative is cropped.
      expect(assets).toHaveLength(1);
      expect(asset.sourceFileIds).toEqual(['exam', 'handwriting']);
      expect(asset.role).toBe('exam_and_handwriting');
      expect(await readFile(source)).toEqual(before);
      const info = await runPdfProcess(python, ['-c', [
        'from PIL import Image',
        'import json, sys',
        'with Image.open(sys.argv[1]) as image:',
        ' rgb = image.convert("RGB")',
        ' print(json.dumps({"width":image.width,"height":image.height,"faintPixel":list(rgb.getpixel((12,562))) if image.width < 1000 else list(rgb.getpixel((100,650)))}))',
      ].join('\n'), path.join(directory, asset.localName)], directory, 30_000);
      const actual = ImageInfoSchema.parse(JSON.parse(info.stdout));
      expect(actual.faintPixel).toEqual([252, 252, 252]);
      expect(actual.width).toBe(trimCombinedImage ? 815 : 1000);
      expect(actual.height).toBe(trimCombinedImage ? 575 : 800);
      if (trimCombinedImage) expect(asset.imageSize).toEqual({ width: actual.width, height: actual.height });
      else expect(await readFile(path.join(directory, asset.localName))).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
