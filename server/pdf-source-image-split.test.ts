import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPdfProcess } from './pdf-runtime.ts';
import { findSourceImageSplit } from './pdf-source-image.ts';

const python = path.resolve('python', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const fixtureScript = String.raw`
from PIL import Image, ImageDraw
import sys

with Image.new("RGB", (500, 900), "white") as image:
    draw = ImageDraw.Draw(image)
    draw.rectangle((30, 150, 459, 305), fill=(44, 44, 44))
    draw.rectangle((30, 570, 459, 740), fill=(88, 88, 88))
    draw.line((474, 10, 474, 890), fill="black", width=1)
    if sys.argv[2] == "connected":
        draw.line((247, 301, 247, 575), fill=(249, 249, 249), width=2)
    image.save(sys.argv[1])
`;
const verifyPanelsScript = String.raw`
from PIL import Image
import sys

with Image.open(sys.argv[1]) as original, Image.open(sys.argv[2]) as upper, Image.open(sys.argv[3]) as lower:
    with Image.new("RGB", (upper.width, upper.height + lower.height)) as joined:
        joined.paste(upper, (0, 0))
        joined.paste(lower, (0, upper.height))
        assert joined.tobytes() == original.crop((25, 100, 475, 800)).tobytes()
`;

describe('two-panel source crop', () => {
  it('splits at a gutter and preserves every pixel between the mapped edges', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-source-split-'));
    try {
      const source = path.join(directory, 'source.png');
      const panels = [path.join(directory, 'upper.png'), path.join(directory, 'lower.png')] as const;
      await runPdfProcess(python, ['-c', fixtureScript, source, 'gutter'], directory);

      const split = await findSourceImageSplit(source, [25, 100, 25, 100], directory, panels);

      expect(split).toEqual({ y: 438, width: 500, height: 900 });
      await runPdfProcess(python, ['-c', verifyPanelsScript, source, ...panels], directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['a faint stroke bridges the gutter', 'connected', [25, 100, 25, 100]],
    ['the crop is shallow', 'gutter', [25, 100, 25, 355]],
  ] as const)('retains the whole original when %s', async (_description, variant, trim) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-source-unsplit-'));
    try {
      const source = path.join(directory, 'source.png');
      await runPdfProcess(python, ['-c', fixtureScript, source, variant], directory);

      const split = await findSourceImageSplit(source, trim, directory);

      expect(split).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
