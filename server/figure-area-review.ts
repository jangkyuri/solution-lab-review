import { z } from 'zod';

const PointSchema = z.tuple([z.number(), z.number()]);
const PathSchema = z.object({
  vertices: z.array(PointSchema),
  closed: z.boolean().optional(),
  fill: z.boolean().optional(),
  arrow: z.string().optional(),
});
const RecipeSchema = z.object({
  schema_version: z.literal('figure_recipe_v1'),
  points: z.record(z.string(), PointSchema).optional(),
  strokes: z.array(z.object({ from: z.string(), to: z.string(), arrow: z.string().optional() })).optional(),
  paths: z.array(PathSchema).optional(),
  curves: z.array(z.object({
    fill_domain: PointSchema.optional(),
    coefficients: z.array(z.number()).optional(),
  })).optional(),
  ellipses: z.array(z.object({ fill: z.boolean().optional() })).optional(),
  visible_annotations: z.array(z.object({ id: z.string(), text: z.string(), target: z.string() })),
});
type Point = Readonly<z.infer<typeof PointSchema>>;
type Recipe = z.infer<typeof RecipeSchema>;
type ShadedArea = { readonly bounds: Point; readonly contains: (tip: Point) => boolean | undefined };

const tolerance = 1e-7;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

function integralInterval(label: string): Point | undefined {
  const bounds = /\\int\s*_\{\s*([+-]?\d+(?:\.\d+)?)\s*\}\s*\^\{\s*([+-]?\d+(?:\.\d+)?)\s*\}/u.exec(label);
  if (!bounds || (label.match(/\\int(?![a-z])/giu)?.length ?? 0) !== 1 || label.includes('=')
    || !/\\mathrm\{d\}\s*x\b|(?<!\p{L})d\s*x\b/u.test(label)) return undefined;
  const from = Number(bounds[1]);
  const to = Number(bounds[2]);
  return Number.isFinite(from) && Number.isFinite(to) && !near(from, to)
    ? [Math.min(from, to), Math.max(from, to)] : undefined;
}

function arrowhead(recipe: Recipe, anchor: string): Point | undefined {
  const origin = recipe.points?.[anchor];
  if (!origin) return undefined;
  const tips: Point[] = [];
  for (const stroke of recipe.strokes ?? []) {
    if (stroke.from !== anchor || stroke.arrow !== 'end') continue;
    const tip = recipe.points?.[stroke.to];
    if (tip) tips.push(tip);
  }
  for (const path of recipe.paths ?? []) {
    const first = path.vertices[0];
    const last = path.vertices.at(-1);
    if (path.arrow === 'end' && !path.closed && first && last
      && near(first[0], origin[0]) && near(first[1], origin[1])) tips.push(last);
  }
  return tips.length === 1 ? tips[0] : undefined;
}

function insidePolygon([x, y]: Point, vertices: readonly Point[]): boolean {
  let previous = vertices.at(-1);
  let inside = false;
  for (const current of vertices) {
    if (!previous) return false;
    const [ax, ay] = previous;
    const [bx, by] = current;
    previous = current;
    if (near(ax, bx) && near(ay, by)) continue;
    const withinEdge = x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
      && y >= Math.min(ay, by) && y <= Math.max(ay, by);
    if (withinEdge && near((bx - ax) * (y - ay), (by - ay) * (x - ax))) return false;
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

function shadedAreas(recipe: Recipe): readonly ShadedArea[] {
  const paths = (recipe.paths ?? []).flatMap((path): readonly ShadedArea[] => {
    if (!path.closed || !path.fill || path.vertices.length < 3) return [];
    const xs = path.vertices.map(([x]) => x);
    return [{ bounds: [Math.min(...xs), Math.max(...xs)], contains: (tip) => insidePolygon(tip, path.vertices) }];
  });
  const curves = (recipe.curves ?? []).flatMap(({ fill_domain: bounds, coefficients }): readonly ShadedArea[] => {
    if (!bounds) return [];
    return [{ bounds, contains: ([x, y]) => {
      if (x <= bounds[0] || x >= bounds[1]) return false;
      if (!coefficients) return undefined;
      const height = coefficients.reduceRight((value, term) => value * x + term, 0);
      return Number.isFinite(height) ? y > Math.min(0, height) && y < Math.max(0, height) : undefined;
    } }];
  });
  return [...paths, ...curves];
}

function outsideArea(areas: readonly ShadedArea[], [left, right]: Point, tip: Point): boolean {
  const matches = ({ bounds }: ShadedArea): boolean => near(bounds[0], left) && near(bounds[1], right);
  if (!areas.some(matches)) return false;
  if (tip[0] <= left || tip[0] >= right) return true;
  return areas.every((area) => area.contains(tip) === false);
}

export function figureLabelIssues(recipe: string): readonly string[] {
  let input: unknown;
  try { input = JSON.parse(recipe); }
  catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  const parsed = RecipeSchema.safeParse(input);
  if (!parsed.success) return [];
  return parsed.data.visible_annotations
    .filter(({ text }) => /[\p{Script=Hangul}\u3130-\u318f]/u.test(text))
    .map(({ id }) => `그림 라벨 ${id}의 한글 설명을 풀이로 옮기고, 그림에는 필요한 수식이나 기호만 남겨주세요.`);
}

/** Checks anchored area labels only where the recipe makes their target unambiguous. */
export function figureAreaIssues(recipe: string, stepLatex = ''): readonly string[] {
  let input: unknown;
  try { input = JSON.parse(recipe); }
  catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  const parsed = RecipeSchema.safeParse(input);
  if (!parsed.success || parsed.data.ellipses?.some(({ fill }) => fill)
    || parsed.data.visible_annotations.some(({ target, text }) => target === 'axis_x' && text !== '$x$' && text !== 'x')) return [];
  const areas = shadedAreas(parsed.data);
  const needsIntegralLabel = /\\int\s*_\{[^{}]+\}\s*\^\{[^{}]+\}/u.test(stepLatex)
    && !parsed.data.visible_annotations.some(({ text }) => /\\int(?![a-z])/iu.test(text));
  return parsed.data.visible_annotations.flatMap((label) => {
    const interval = integralInterval(label.text);
    const numericArea = needsIntegralLabel
      && /^넓이\s*(?:[=:]\s*)?\$?\s*(?:\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|\\(?:d|t)?frac\{\d+\}\{\d+\})\s*\$?$/u.test(label.text.trim());
    if (!interval && !numericArea) return [];
    const tip = arrowhead(parsed.data, label.target);
    if (!tip) return [];
    if (interval && outsideArea(areas, interval, tip)) {
      return [`${label.text}의 화살촉을 해당 적분 구간의 음영 내부에 놓아주세요.`];
    }
    if (numericArea && areas.some((area) => area.contains(tip) === true)) {
      return [`${label.text} 대신 적분 구간과 피적분함수를 포함한 정적분식을 화살표에 연결해주세요.`];
    }
    return [];
  });
}
