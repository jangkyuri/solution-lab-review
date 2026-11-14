import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { pythonExecutable, withMathWorker } from './math-engine.ts';
import { PdfProcessError, runPdfProcess } from './pdf-runtime.ts';

const pythonRoot = fileURLToPath(new URL('../python/', import.meta.url));
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const RenderSchema = z.object({
  path: z.string(), bytes: z.number().int().positive(), labels: z.array(z.string()).max(80),
  sha256: sha, recipe_sha256: sha,
});
export type FigureRecipeRender = z.infer<typeof RenderSchema>;

const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

export async function renderFigureRecipe(recipe: string, outputPath: string): Promise<FigureRecipeRender> {
  if (recipe.length > 1_000_000 || !recipe.trim()) throw new AppError(400, '그래프 레시피의 길이를 확인해주세요.');
  return withMathWorker(async () => {
    const temp = await mkdtemp(join(tmpdir(), 'solution-lab-recipe-'));
    const source = join(temp, 'recipe.json');
    const destination = resolve(outputPath);
    try {
      await writeFile(source, recipe, 'utf8');
      const result = await runPdfProcess(pythonExecutable(),
        ['-I', '-X', 'utf8', join(pythonRoot, 'render_figure_recipe.py'), source, destination], pythonRoot, 30_000);
      const output = RenderSchema.parse(JSON.parse(result.stdout));
      const png = await readFile(destination);
      if (resolve(output.path) !== destination || png.length !== output.bytes
        || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || digest(png) !== output.sha256 || digest(recipe) !== output.recipe_sha256) {
        throw new AppError(500, '그래프 파일과 SHA-256 기록이 일치하지 않습니다.');
      }
      return output;
    } catch (error) {
      if (error instanceof PdfProcessError) {
        const detail = error.details.trim().split(/\r?\n/u).filter(Boolean).at(-1)?.slice(0, 400);
        throw new AppError(400, `그래프 레시피를 그리지 못했습니다.${detail ? ` ${detail}` : ''}`);
      }
      throw error;
    } finally {
      await unlink(source).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      });
      await rmdir(temp);
    }
  });
}

export async function validateFigureRecipe(recipe: string): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'solution-lab-recipe-check-'));
  const output = join(temp, 'figure.png');
  try { await renderFigureRecipe(recipe, output); }
  finally {
    await unlink(output).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
    await rmdir(temp);
  }
}
