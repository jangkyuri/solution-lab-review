import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN } from '../shared/pdf-design.ts';
import { jobFixture } from './generation-fixtures.ts';
import { buildJobPdf } from './pdf.ts';
import { runPdfProcess } from './pdf-runtime.ts';

const makeOriginal = String.raw`
from pathlib import Path
import sys
from PIL import Image, ImageDraw
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader

directory = Path(sys.argv[1])
with Image.new("RGB", (844, 741), "white") as image:
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 843, 740), outline="black", width=4)
    draw.text((30, 25), "21. SOURCE ORIGINAL", fill="black", font_size=30)
    draw.text((30, 130), "f(x) = x^2, x > 0", fill="black", font_size=26)
    draw.rectangle((30, 230, 810, 470), outline="black", width=3)
    draw.text((50, 260), "a + b = 3", fill="black", font_size=28)
    draw.text((50, 340), "Find f(2).", fill="black", font_size=28)
    draw.text((30, 640), "(1) 1   (2) 2   (3) 3   (4) 4   (5) 5", fill="black", font_size=24)
    image.save(directory / "original.png", dpi=(200, 200))
    width = 595.2756
    inner_width = width - 48
    inner_height = inner_width * 741 / 844
    canvas = Canvas(str(directory / "original.pdf"), pagesize=(width, inner_height + 48))
    canvas.drawImage(ImageReader(image), 24, 24, width=inner_width, height=inner_height)
    canvas.showPage()
    canvas.save()
`;

const inspectOriginal = String.raw`
from pathlib import Path
import hashlib
import json
import sys
from PIL import Image
from pypdf import PdfReader
import pdfplumber

directory = Path(sys.argv[1])
with Image.open(directory / "original.png") as expected:
    original_hash = hashlib.sha256(expected.convert("RGB").tobytes()).hexdigest()
reader = PdfReader(sys.argv[2])
pages = []
with pdfplumber.open(sys.argv[2]) as document:
    for index, page in enumerate(document.pages[1:], start=1):
        marker = ["FirstBodyMarker", "SecondBodyMarker"][index - 1]
        bodies = page.search(marker)
        images = page.images
        hashes = [hashlib.sha256(image.image.convert("RGB").tobytes()).hexdigest() for image in reader.pages[index].images]
        headers = page.search("21번")
        pages.append({
            "number": index + 1,
            "text": page.extract_text() or "",
            "hashes": hashes,
            "images": [{"x": image["x0"], "top": image["top"], "width": image["width"], "height": image["height"], "bottom": image["bottom"]} for image in images],
            "bodyTop": bodies[0]["top"] if bodies else None,
            "headerBottom": headers[0]["bottom"] if headers else None,
            "pageWidth": page.width,
            "pageHeight": page.height,
        })
print(json.dumps({"pageCount": len(reader.pages), "originalHash": original_hash, "pages": pages}))
`;

const InspectionSchema = z.object({
  pageCount: z.number(), originalHash: z.string(),
  pages: z.array(z.object({
    number: z.number(), text: z.string(), hashes: z.array(z.string()),
    images: z.array(z.object({ x: z.number(), top: z.number(), width: z.number(), height: z.number(), bottom: z.number() })),
    bodyTop: z.number().nullable(), headerBottom: z.number().nullable(), pageWidth: z.number(), pageHeight: z.number(),
  })),
});

async function inspectionPython(directory: string): Promise<string> {
  const configured = process.env['SOLUTION_LAB_PDF_INSPECTION_PYTHON'];
  if (configured) return configured;
  const located = await runPdfProcess('where.exe', ['pdfinfo.exe'], directory, 10_000);
  const executable = located.stdout.trim().split(/\r?\n/u)[0];
  if (!executable) throw new Error('Missing bundled PDF inspection runtime');
  return path.resolve(path.dirname(executable), '..', '..', '..', '..', 'python', 'python.exe');
}

describe('original exam crop compilation', () => {
  it('repeats the original pixels at the exact physical size above each continuation body', async () => {
    // Given: the same attached PDF has two role IDs and one tall 200-dpi original crop.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-original-crop-'));
    try {
      const python = await inspectionPython(directory);
      await runPdfProcess(python, ['-c', makeOriginal, directory], directory, 30_000);
      const diskPath = path.join(directory, 'original.pdf');
      const bytes = await readFile(diskPath);
      const files = [
        { id: 'handwriting-alias', name: 'same-original.pdf', mimeType: 'application/pdf', role: 'handwriting', diskPath },
        { id: 'exam-alias', name: 'original-exam.pdf', mimeType: 'application/pdf', role: 'exam', diskPath },
      ] as const;
      const job = JobSchema.parse({
        ...jobFixture, status: 'ready', title: 'Original crop verification',
        pdfDesign: { ...BAEKSIN_V16_PDF_DESIGN, stepLayout: 'separate' },
        files: files.map(file => ({ ...file, size: bytes.length, url: `/api/files/${file.id}` })),
        originalProblems: [{ questionNumber: '21', fileId: 'exam-alias', page: 1, trim: [24, 24, 24, 24], widthBp: 303.84 }],
        result: { summary: '', references: [], limitations: [], questions: [{
          number: '21', problemText: 'TypedProblemSentinel', firstDecision: '', variables: ['x'], observedOrder: [],
          steps: ['FirstBodyMarker', 'SecondBodyMarker'].map((explanation, index) => ({
            id: `S0${index + 1}`, after: [], branch: null, title: '', explanation,
            originalStep: '', evidence: '', graph: null, latex: '', booklet: { group: index === 0 ? 'A' : 'B' },
          })), answer: '4', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
        }] },
      });
      const original = structuredClone(job);

      // When: the actual staging, deduplication and XeLaTeX export pipeline runs.
      const output = await buildJobPdf(job, files, directory);
      const inspected = await runPdfProcess(python, ['-c', inspectOriginal, directory, output.path], directory, 30_000);
      const evidence = InspectionSchema.parse(JSON.parse(inspected.stdout));

      // Then: each real continuation preserves the crop, association and clear body space.
      expect(output.pageCount).toBe(3);
      expect(evidence.pageCount).toBe(3);
      expect(evidence.pages.map(page => page.number)).toEqual([2, 3]);
      for (const page of evidence.pages) {
        expect(page.text).not.toContain('TypedProblemSentinel');
        expect(page.text.match(/21번/gu)).toHaveLength(1);
        expect(page.hashes).toEqual([evidence.originalHash]);
        expect(page.images).toHaveLength(1);
        const image = page.images[0];
        if (!image || page.bodyTop === null || page.headerBottom === null) throw new Error('Missing compiled crop or text positions');
        expect(Math.abs(image.width - 303.84)).toBeLessThan(0.1);
        expect(Math.abs(image.height - 266.76)).toBeLessThan(0.1);
        expect(image.x).toBeGreaterThanOrEqual(0);
        expect(image.x + image.width).toBeLessThanOrEqual(page.pageWidth);
        expect(page.headerBottom).toBeLessThan(image.top);
        expect(page.bodyTop - image.bottom).toBeGreaterThan(20);
        expect(page.bodyTop).toBeLessThan(page.pageHeight - 30);
      }
      expect(job).toStrictEqual(original);
      if (process.env['SOLUTION_LAB_PDF_QA'] === '1') {
        const destination = path.resolve('latex', 'qa');
        await mkdir(destination, { recursive: true });
        await copyFile(output.path, path.join(destination, 'original-crop-continuation-verification.pdf'));
      }
    } finally {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('solution-lab-original-crop-')) throw new Error('Unexpected original crop test directory');
      await rm(resolved, { recursive: true, force: true });
    }
  }, 150_000);
});
