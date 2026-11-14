import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runPdfProcess } from './pdf-runtime.ts';

const runtimeRoot = fileURLToPath(new URL('../python/', import.meta.url));
const ImageSizeSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict();
const trimScript = String.raw`
from PIL import Image, ImageOps
import json, math, sys
import numpy as np

def ink_components(ink: np.ndarray) -> list[tuple[tuple[int, int, int, int], int]]:
    """Find actual connected ink bounds using row runs rather than coarse tiles."""
    parents: list[int] = []
    boxes: list[tuple[int, int, int, int]] = []
    amounts: list[int] = []
    previous: list[tuple[int, int, int]] = []

    def root(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def unite(first: int, second: int) -> None:
        first, second = root(first), root(second)
        if first == second:
            return
        if amounts[first] < amounts[second]:
            first, second = second, first
        parents[second] = first
        a, b = boxes[first], boxes[second]
        boxes[first] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
        amounts[first] += amounts[second]

    for y, row in enumerate(ink):
        changes = np.flatnonzero(np.diff(np.concatenate(([False], row, [False]))))
        current: list[tuple[int, int, int]] = []
        previous_start = 0
        for raw_start, raw_end in changes.reshape(-1, 2):
            start, end = int(raw_start), int(raw_end)
            label = len(parents)
            parents.append(label)
            boxes.append((start, y, end, y + 1))
            amounts.append(end - start)
            current.append((start, end, label))
            while previous_start < len(previous) and previous[previous_start][1] < start:
                previous_start += 1
            neighbor = previous_start
            while neighbor < len(previous) and previous[neighbor][0] <= end:
                unite(label, previous[neighbor][2])
                neighbor += 1
        previous = current
    return [(boxes[index], amounts[index]) for index in range(len(parents)) if parents[index] == index]


def content_bounds(grayscale: Image.Image) -> tuple[int, int, int, int] | None:
    """Retain detached strokes; disregard only distant, tiny point-like scan dust."""
    ink = np.asarray(grayscale) < 254
    height, width = ink.shape
    components = ink_components(ink)
    anchors = []
    for bounds, amount in components:
        span_x, span_y = bounds[2] - bounds[0], bounds[3] - bounds[1]
        elongated = max(span_x, span_y) >= 6 and max(span_x, span_y) >= min(span_x, span_y) * 2.2
        if max(span_x, span_y) >= 12 or amount > 100 or elongated:
            anchors.append(bounds)
    if not anchors:
        return grayscale.point(lambda value: 255 if value < 254 else 0).getbbox()
    near = max(24, math.ceil(min(width, height) * 0.04))
    left = min(bounds[0] for bounds in anchors) - near
    top = min(bounds[1] for bounds in anchors) - near
    right = max(bounds[2] for bounds in anchors) + near
    bottom = max(bounds[3] for bounds in anchors) + near
    retained = [bounds for bounds, _ in components
                if bounds[0] <= right and bounds[2] >= left and bounds[1] <= bottom and bounds[3] >= top]
    return (min(bounds[0] for bounds in retained), min(bounds[1] for bounds in retained),
            max(bounds[2] for bounds in retained), max(bounds[3] for bounds in retained))
with Image.open(sys.argv[1]) as original:
    oriented = ImageOps.exif_transpose(original)
    rgba = oriented.convert("RGBA")
    background = Image.new("RGBA", rgba.size, "white")
    image = Image.alpha_composite(background, rgba).convert("RGB")
    grayscale = ImageOps.grayscale(image)
    bounds = content_bounds(grayscale)
    if bounds is not None:
        padding = min(40, max(12, math.ceil(min(image.size) * 0.012)))
        left, top, right, bottom = bounds
        bounds = (max(0, left-padding), max(0, top-padding), min(image.width, right+padding), min(image.height, bottom+padding))
        image = image.crop(bounds)
    image.save(sys.argv[2], "PNG")
    print(json.dumps({"width": image.width, "height": image.height}))
`;

function sourceImagePython(): string {
  return process.env['SOLUTION_LAB_PYTHON'] ?? path.resolve(runtimeRoot,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
}

export async function trimSourceImage(source: string, destination: string, stage: string): Promise<z.infer<typeof ImageSizeSchema>> {
  const output = await runPdfProcess(sourceImagePython(), ['-c', trimScript, source, destination], stage, 30_000);
  return ImageSizeSchema.parse(JSON.parse(output.stdout));
}

const splitScript = String.raw`
from PIL import Image, ImageOps
import json, sys
import numpy as np

def choose_split(crop):
    width, height = crop.size
    if height < 1.15 * width:
        return None
    pixels = np.asarray(ImageOps.grayscale(crop))
    background = float(np.quantile(pixels, 0.75))
    scanned_paper = np.median(pixels) < 254 and np.quantile(pixels, 0.25) < 253
    threshold = min(225 if scanned_paper else 250, background - 5)
    ink = pixels < threshold
    # Ignore long straight scan borders in the measurement only.
    edge = max(1, round(width * 0.03))
    for start, stop in ((0, edge), (width - edge, width)):
        side = ink[:, start:stop]
        rules = side.mean(axis=0) >= 0.94
        side[:, rules] = False
    if scanned_paper:
        # The outermost scan edge can contain a tilted border. All pixels remain in the output panels.
        border = max(1, round(width * 0.008))
        ink[:, :border] = False
        ink[:, -border:] = False
    occupied = ink.any(axis=1)
    changes = np.flatnonzero(np.diff(np.concatenate(([False], ~occupied, [False]))))
    minimum = max(8, round(height * 0.008))
    candidates = []
    for start, end in changes.reshape(-1, 2):
        midpoint = (int(start) + int(end)) // 2
        if end - start < minimum or not 0.33 * height <= midpoint <= 0.67 * height:
            continue
        if occupied[:start].any() and occupied[end:].any():
            candidates.append(midpoint)
    return min(candidates, key=lambda y: abs(y - height / 2), default=None)

with Image.open(sys.argv[1]) as original:
    oriented = ImageOps.exif_transpose(original).convert('RGBA')
    paper = Image.new('RGBA', oriented.size, 'white')
    image = Image.alpha_composite(paper, oriented).convert('RGB')
    left, bottom, right, top = map(int, sys.argv[2:6])
    width, height = image.size
    right, bottom = width - right, height - bottom
    if right <= left or bottom <= top:
        print('null')
    else:
        split = choose_split(image.crop((left, top, right, bottom)))
        if split is None:
            print('null')
        else:
            y = top + split
            if len(sys.argv) == 8:
                image.crop((left, top, right, y)).save(sys.argv[6], 'PNG')
                image.crop((left, y, right, bottom)).save(sys.argv[7], 'PNG')
            print(json.dumps({'y': y, 'width': width, 'height': height}))
`;

const SourceSplitSchema = ImageSizeSchema.extend({ y: z.number().int().positive() }).nullable();

export async function findSourceImageSplit(source: string, trimPixels: readonly [number, number, number, number], stage: string,
  panels?: readonly [string, string]): Promise<z.infer<typeof SourceSplitSchema>> {
  const { stdout } = await runPdfProcess(sourceImagePython(), ['-I', '-c', splitScript, source, ...trimPixels.map(String), ...(panels ?? [])], stage, 30_000);
  return SourceSplitSchema.parse(JSON.parse(stdout));
}
