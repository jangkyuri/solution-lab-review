import type { Job } from '../shared/contracts.ts';
import { z } from 'zod';
import type { GeneratedResult, Reading } from './generation-schemas.ts';
import { usesHandwriting } from './generation-schemas.ts';
import { safeMath } from './pdf-safety.ts';
import { graphInlineLabel } from './pdf-graph-labels.ts';
import { DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import { hasUncertainSourceErrorClaim } from './generation-claims.ts';

const RecipePointSchema = z.tuple([z.number(), z.number()]);
const RecipeShapeSchema = z.object({
  schema_version: z.literal('figure_recipe_v1'),
  curves: z.array(z.object({ expression: z.string().optional(), coefficients: z.array(z.number()).optional() })).optional(),
  points: z.record(z.string(), RecipePointSchema).optional(),
  strokes: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  segments: z.array(z.tuple([z.string(), z.string()])).optional(),
  paths: z.array(z.object({ vertices: z.array(RecipePointSchema) })).optional(),
  visible_annotations: z.array(z.object({ text: z.string() })),
});

function recipeShape(value: string | null | undefined): z.infer<typeof RecipeShapeSchema> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = RecipeShapeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const constantExpression = /^[+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?$/u;

function recipeScene(recipe: z.infer<typeof RecipeShapeSchema>, variable: string) {
  const expressions = (recipe.curves ?? []).map((curve) => curve.expression?.trim() || JSON.stringify(curve.coefficients));
  const lines = [...(recipe.segments ?? []), ...(recipe.strokes ?? []).map(({ from, to }) => [from, to] as const)];
  const horizontal = (from: [number, number] | undefined, to: [number, number] | undefined): boolean =>
    from !== undefined && to !== undefined && from[1] === to[1] && from[0] !== to[0];
  const comparisonLine = (recipe.curves ?? []).some((curve) => (
    curve.expression !== undefined && constantExpression.test(curve.expression.replace(/[()\s]/gu, ''))
  ) || (curve.coefficients?.length === 1))
    || lines.some(([from, to]) => horizontal(recipe.points?.[from], recipe.points?.[to]))
    || recipe.paths?.some(({ vertices }) => vertices.length === 2 && horizontal(vertices[0], vertices[1]))
    || false;
  return { expressions, comparisonLine, variable };
}

function visualScenes(question: GeneratedResult['questions'][number], variables: readonly string[]) {
  const variable = variables.find((name) => /^[xt]$/u.test(name)) ?? 'x';
  return question.steps.flatMap((step) => {
    const recipe = recipeShape(step.figureRecipe);
    if (recipe) return [recipeScene(recipe, variable)];
    const graph = step.graph;
    if (!graph || graph.qualitative || !(graph.curves.length || graph.points.length || graph.arrows.length)) return [];
    return [{
      expressions: graph.curves.map((curve) => curve.expression.trim()), variable: graph.variable,
      comparisonLine: graph.horizontals.length > 0 || graph.curves.some((curve) => constantExpression.test(curve.expression.replace(/[()\s]/gu, ''))),
    }];
  });
}

function namedFunctions(text: string): Set<string> {
  const names = [...text.matchAll(/(?<![A-Za-z\\])([A-Za-z])(?:[′'’]|\^\{?\\prime\}?)*\s*(?:\\left\s*)?\(/gu)];
  return new Set(names.flatMap((match) => match[1] ? [match[1]] : []));
}

function studentFields(step: GeneratedResult['questions'][number]['steps'][number], includeRawMath = true): string[] {
  return [step.title, step.explanation, includeRawMath ? step.latex : undefined, step.graph?.title, step.graph?.explanation,
    ...(recipeShape(step.figureRecipe)?.visible_annotations.map(({ text }) => text) ?? []),
    step.graph?.xLabel, step.graph?.yLabel,
    ...(step.graph?.curves.map((curve) => curve.label) ?? []), ...(step.graph?.points.map((point) => point.label) ?? []),
    ...(step.graph?.verticals.map((line) => line.label) ?? []), ...(step.graph?.horizontals.map((line) => line.label) ?? []),
    ...(step.graph?.arrows.map((arrow) => arrow.label) ?? []), ...(step.graph?.shades.map((shade) => shade.label) ?? []),
    step.booklet?.equationNote, step.booklet?.takeaway, step.booklet?.referenceTip, step.booklet?.zoomNote,
    ...(step.booklet?.keyPhrases ?? []),
    ...(step.booklet?.termNotes?.map((note) => includeRawMath ? `${note.term} ${note.note}` : note.note) ?? []),
    ...(step.booklet?.graphLinks?.flatMap((link) => [...(includeRawMath ? [link.latex, link.note] : [link.note]), ...(link.anchorLabels ?? [])]) ?? []),
    ...(step.booklet?.table?.flat() ?? []),
  ].filter((value): value is string => typeof value === 'string');
}

const controlCharacters = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u;
type InlineMathFault = { readonly kind: string; readonly fragment: string };

function mathFragment(value: string): string {
  return JSON.stringify(value.length > 180 ? `${value.slice(0, 177)}...` : value);
}

function inlineMathFault(fields: readonly string[]): InlineMathFault | null {
  for (const field of fields) {
    const control = controlCharacters.exec(field);
    if (control) return { kind: '제어 문자', fragment: field.slice(Math.max(0, control.index - 40), control.index + 140) };
    const formulas = [...field.matchAll(/\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/gu)];
    for (const formula of formulas) {
      if (safeMath(formula[1] ?? formula[2] ?? '') === null) return { kind: '인라인 수식', fragment: formula[0] };
    }
    const unmatched = [...field.matchAll(/\\[()]/gu)].find((delimiter) => !formulas.some((formula) => delimiter.index >= formula.index && delimiter.index < formula.index + formula[0].length));
    if (unmatched) return { kind: '닫히지 않은 수식 구분자', fragment: field.slice(Math.max(0, unmatched.index - 40), unmatched.index + 140) };
  }
  return null;
}

function containsWholePhrase(text: string, phrase: string): boolean {
  if (!phrase.trim()) return false;
  const formulas = [...text.matchAll(/\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/gu)]
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
  for (let start = text.indexOf(phrase); start >= 0; start = text.indexOf(phrase, start + 1)) {
    const end = start + phrase.length;
    if (formulas.every((formula) => end <= formula.start || start >= formula.end || (start <= formula.start && end >= formula.end))) return true;
  }
  return false;
}

function repeatsDisplayedEquation(step: GeneratedResult['questions'][number]['steps'][number]): boolean {
  const rows = step.booklet?.table?.slice(1);
  if (!rows?.length || !step.latex.trim()) return false;
  const compact = (value: string): string => value.replace(/[&{}\s]/gu, '');
  const equation = compact(step.latex);
  return rows.every((row) => {
    if (row.length !== 2) return false;
    const left = /^\\\(([\s\S]+)\\\)$/u.exec(row[0]?.trim() ?? '')?.[1];
    const right = /^\\\(([\s\S]+)\\\)$/u.exec(row[1]?.trim() ?? '')?.[1];
    return left !== undefined && right !== undefined && equation.includes(`${compact(left)}=${compact(right)}`);
  });
}

function missesAbsoluteIntersectionTarget(source: string, question: GeneratedResult['questions'][number], scenes: ReturnType<typeof visualScenes>): boolean {
  if (!/절댓값|\\lvert|\|[^|]+\|/u.test(source) || !/교점|만나는[\s\S]{0,50}(?:점|개수)/u.test(source)) return false;
  const line = /직선[\s\S]{0,30}y\s*=\s*([A-Za-z]|[+-]?\d+(?:\.\d+)?)\s*(?:\\\)|\$|(?=[가-힣])|$)/u.exec(source);
  if (!/수평선/u.test(source) && !line) return false;
  const numericGraphs = scenes.filter(({ expressions }) => expressions.length > 0);
  if (!numericGraphs.length || (line?.[1] && numericGraphs.some((scene) => scene.variable === line[1]))) return false;
  const plainSource = source.replace(/\\[()]|\$/gu, '');
  const requested = [...plainSource.matchAll(/(?:^|[^A-Za-z])([A-Za-z])\s*의\s*값(?:은|을|이)?/gu)].at(-1)?.[1];
  const target = /\|([^|]+)\|/u.exec(source)?.[1] ?? /\\lvert([\s\S]*?)\\rvert/u.exec(source)?.[1];
  const variable = numericGraphs[0]?.variable;
  if (!requested || !target || !variable) return false;
  const symbols = target.replace(/\\(?:frac|dfrac|tfrac|sqrt|left|right|cdot|times|sin|cos|tan|exp|log|ln)\b/gu, '');
  const parameters = new Set((symbols.match(/[A-Za-z]/gu) ?? []).filter((symbol) => symbol !== variable));
  if (!parameters.has(requested)) return false;
  const answer = question.answer.replace(/\\[()]|\$/gu, '').trim();
  const numericallyBound = (symbol: string): boolean => {
    const rhs = new RegExp(`(?:^|[,;\\s])${symbol}\\s*=\\s*([^,;]+)`, 'u').exec(answer)?.[1];
    if (!rhs) return false;
    const numeric = rhs.replace(/\\(?:frac|dfrac|tfrac|sqrt|left|right|cdot|times|quad|qquad)\b/gu, '');
    return /\d/u.test(numeric) && /^[\d\s{}().+*/^\-]+$/u.test(numeric);
  };
  if (![...parameters].every(numericallyBound)) return false;
  return !numericGraphs.some(({ expressions, comparisonLine }) => comparisonLine && expressions.some((expression) => /\babs\s*\(/iu.test(expression)));
}

export function generationQualityIssues(
  job: Pick<Job, 'mode' | 'pdfDesign'> & Partial<Pick<Job, 'subject'>>, reading: Reading, generated: GeneratedResult,
): string[] {
  const issues: string[] = [];
  const calculusOne = /^(?:미적|미적분)(?:1|I)$/u.test(job.subject?.normalize('NFKC').replace(/\s+/gu, '') ?? '');
  for (const question of generated.questions) {
    const extremumText = [question.firstDecision, question.answer, ...question.steps.flatMap((step) => studentFields(step))].join('\n');
    if (/상한|하한/u.test(extremumText)) {
      issues.push(`${question.number}번: 상한·하한 대신 실제 가능한 값과 가까워지는 값을 쉽게 설명해주세요. 값이 실제로 나오지 않으면 최댓값·최솟값으로 바꾸어 단정하지 마세요.`);
    }
    if (calculusOne && (job.pdfDesign ?? DEFAULT_PDF_DESIGN).sourceLayout === 'stacked-reference'
      && /집합|원소|포함\s*관계|\\(?:in|notin|cap|cup|subset|subseteq|supset|supseteq|emptyset|varnothing)\b/u.test(extremumText)) {
      issues.push(`${question.number}번: 집합 용어나 기호 대신 실제 가능한 값과 조건을 직접 써주세요. 두 후보는 '또는', 함께 필요한 조건은 두 식으로 적고 원문 전사는 유지해주세요.`);
    }
    if (/(?:\\(?:max|min)|\\operatorname\*?\s*\{\s*(?:max|min)\s*\}|(?<![A-Za-z\\])(?:max|min))\s*(?:\\(?:limits|nolimits)\s*)?_/iu.test(extremumText)) {
      issues.push(`${question.number}번: 최댓값·최솟값은 범위를 붙인 max/min 표기 대신 한글과 실제 함숫값 비교로 설명해주세요. 범위 조건은 본문에 유지해주세요.`);
    }
    const source = reading.questions.find((item) => item.number === question.number);
    const scenes = visualScenes(question, source?.variables ?? question.variables);
    if (source && /그래프를\s*(?:직접\s*)?(?:그려|그리시오)/u.test(source.problemText)
      && /\b[A-Za-z]\s*\(\s*[A-Za-z]\s*\)\s*=/u.test(source.problemText)
      && !scenes.some(({ expressions }) => expressions.some(Boolean))) {
      issues.push(`${question.number}번: 문제에서 그리라고 한 그래프가 빠졌습니다. 실제 함수식과 교점·극점 등 풀이에 필요한 좌표를 해당 단계의 그림에 넣어주세요.`);
    }
    if (source && missesAbsoluteIntersectionTarget(source.problemText, question, scenes)) {
      issues.push(`${question.number}번: 수평선과 교점 수를 세는 실제 절댓값 대상 그래프와 비교 직선이 빠졌습니다. 매개변수가 확정되는 원문 결론 단계에 실제 대상과 조건을 판정하는 높이·교점을 표시해주세요. 기본 곡선만으로 대신하지 말고 근거 없는 매개변수 예시를 앞 단계에 넣지 마세요.`);
    }
    if (source && /접선/u.test(source.problemText) && /거리/u.test(source.problemText)) {
      const hasAbsoluteCurve = scenes.some(({ expressions }) => expressions.some((expression) => /\babs\s*\(/iu.test(expression)));
      const distinctScenes = new Set(scenes.map(({ expressions }) => JSON.stringify([...new Set(expressions.map((expression) => expression.replace(/\s/gu, '').replace(/\*\*/gu, '^')))].sort())));
      if (hasAbsoluteCurve && distinctScenes.size < 2) {
        issues.push(`${question.number}번: 접선의 높이·거리 관계와 절댓값 변환을 서로 다른 그래프 장면으로 보여주세요. 원문 또는 해당 단계까지 유도한 식·기하관계에서 근거를 고르고, 같은 곡선의 복제나 임의의 예시 함수·아직 구하지 않은 최종값으로 채우지 마세요.`);
      }
    }
    if (job.mode !== 'supplement' && job.pdfDesign?.template !== 'baeksin-v16') continue;
    if (job.pdfDesign?.template === 'baeksin-v16' && question.steps.length >= 2 && question.steps.some((step) => step.latex.trim())) {
      const keyEquations = question.steps.filter((step) => step.booklet?.equationRole === 'key').length;
      const keyPhrases = question.steps.flatMap((step) => step.booklet?.keyPhrases ?? []).length;
      if (keyEquations > 1 || keyPhrases < 1 || keyPhrases > 3) {
        issues.push(`${question.number}번: 큰 핵심 수식은 짧은 한 줄 중심 관계에만 문항당 0~1개 선택하고, 짧은 판단은 1~3개 선택해주세요. 큰 수식 강조가 없어도 되며, 여러 줄 계산 전개와 나머지 수식·문장은 기본 크기로 둡니다.`);
      }
    }
    if (!source) continue;
    const supplement = usesHandwriting(job.mode, source);
    const certaintyClaims = [extremumText, ...question.uncertainties, ...Object.values(question.checks).flat(),
      ...question.steps.flatMap((step) => [step.evidence, step.sourceConflict ?? '']),
      ...(generated.questions.length === 1 ? [generated.summary, ...generated.limitations] : [])];
    if (hasUncertainSourceErrorClaim(source, certaintyClaims)) {
      issues.push(`${question.number}번: 판독이 불확실한 필기를 계산 오류로 단정하지 마세요. 확정한 함수식에서 계산한 값과 불확실한 원문 수치는 구별해주세요.`);
    }
    const questionFault = inlineMathFault([source.problemText, question.firstDecision, question.answer]);
    if (questionFault) {
      issues.push(`${question.number}번: 문제 또는 답의 ${questionFault.kind} 표기가 손상되었습니다. 오류 조각은 ${mathFragment(questionFault.fragment)}입니다. LaTeX 명령과 구분자를 확인해주세요.`);
    }
    const sourceText = [source.problemText, ...source.variables, ...source.observedSteps.map((step) => step.text), ...source.visualObservations].join('\n');
    const allowed = namedFunctions(sourceText);
    for (const variable of source.variables) {
      for (const match of variable.matchAll(/(?<![A-Za-z\\])([A-Za-z])(?![A-Za-z])/gu)) {
        if (match[1]) allowed.add(match[1]);
      }
    }
    for (const match of sourceText.matchAll(/(?<![A-Za-z\\])([A-Z])(?![A-Za-z])/gu)) {
      if (match[1]) allowed.add(match[1]);
    }
    const introduced = new Set<string>();
    for (const step of question.steps) {
      if (step.figureRecipe != null && (step.booklet?.graphLinks?.length || step.booklet?.zoom || step.booklet?.zoomNote)) {
        issues.push(`${question.number}번 ${step.id}: 점·식의 연결과 확대에 필요한 표시는 그림 레시피에 넣고 booklet의 그래프 연결·확대 항목은 비워주세요.`);
      }
      if ((job.pdfDesign ?? DEFAULT_PDF_DESIGN).sourceLayout === 'stacked-reference' && repeatsDisplayedEquation(step)) {
        issues.push(`${question.number}번 ${step.id}: 이미 제시한 식을 표에 반복하지 말고 한 번만 남겨주세요. 표는 서로 다른 조건·경우를 비교할 때 사용해주세요.`);
      }
      const fields = studentFields(step);
      const text = fields.join('\n');
      for (const [index, link] of (step.booklet?.graphLinks ?? []).entries()) {
        const prefix = `${question.number}번 ${step.id}: 그래프 연결 ${index + 1}`;
        const labels = link.anchorLabels?.map((label) => label.trim()) ?? [];
        if (labels.some(Boolean) && labels.length !== link.anchors.length) {
          issues.push(`${prefix}의 점 옆 라벨 수는 시작점 수와 같아야 합니다. anchors와 같은 순서로 각 점의 의미를 써주세요.`);
        }
        if (labels.some(Boolean) && labels.some((label) => !label)) {
          issues.push(`${prefix}의 점 옆 라벨에 빈 항목이 있습니다. 일부 점의 대응을 비우지 말고 실제 의미를 쓰거나 라벨 전체를 생략해주세요.`);
        }
        if (labels.some((label) => graphInlineLabel(label).width > 176)) {
          issues.push(`${prefix}의 점 옆 라벨이 표시 공간보다 깁니다. 실제 점의 짧은 의미만 남기고 자세한 수식과 이유는 연결의 latex·note에 보존해주세요.`);
        }
        const linkMath = safeMath(link.latex);
        if (controlCharacters.test(link.latex) || linkMath === null) {
          issues.push(`${prefix}의 그래프 연결 수식이 손상되었습니다. 오류 조각은 ${mathFragment(link.latex)}입니다. 구분자 없는 안전한 수식 내용만 써주세요.`);
        }
        const linkMathWidth = linkMath === null ? 0 : linkMath.replace(/\\[A-Za-z]+/gu, 'x').replace(/[{}\s]/gu, '').length * 5.2;
        if (linkMathWidth > 176) {
          issues.push(`${prefix}의 연결 수식이 표시 공간보다 깁니다. 오류 조각은 ${mathFragment(link.latex)}입니다. 원래 수식은 단계 수식에 보존하고 연결에는 대응하는 짧은 식이나 완전한 항을 써주세요.`);
        }
        if (step.booklet?.zoom && !labels.some(Boolean) && linkMathWidth <= 176 && linkMathWidth * 1.75 + 10 > 244) {
          issues.push(`${prefix}의 점 옆 수식이 확대 그림의 본 그림 공간보다 깁니다. 원래 수식은 단계 수식에 보존하고 점 옆에는 짧은 식·항을 쓰거나 anchorLabels로 짧은 의미를 표시해 연결식을 그림 아래에 두세요.`);
        }
        const graph = step.graph;
        if (!graph) {
          issues.push(`${prefix}에는 현재 단계 그래프가 필요합니다.`);
          continue;
        }
        const linkedPoints = link.anchors.map((anchor) => graph.points.find((point) => Math.abs(point.x - anchor.x) < 1e-8 && Math.abs(point.y - anchor.y) < 1e-8));
        if (linkedPoints.some((point) => point === undefined)) {
          issues.push(`${prefix}의 시작점은 현재 단계 그래프의 점 좌표와 일치해야 합니다. 다른 단계의 점이나 새 수치 예시를 연결하지 마세요.`);
        }
        const resolved = linkedPoints.filter((point) => point !== undefined);
        if (resolved.some((anchor, anchorIndex) => resolved.slice(0, anchorIndex).some((previous) => Math.abs(anchor.x - previous.x) < 1e-8 && Math.abs(anchor.y - previous.y) < 1e-8))) {
          issues.push(`${prefix} 안에 같은 점을 두 번 넣을 수 없습니다. 같은 그래프 점에 대응하는 시작점은 하나만 남겨주세요.`);
        }
        if (link.anchors.some((anchor) => anchor.x < graph.xMin || anchor.x > graph.xMax || anchor.y < graph.yMin || anchor.y > graph.yMax)) {
          issues.push(`${prefix}의 시작점이 그래프 범위 밖에 있습니다. 근거 있는 점과 화면 범위를 확인해주세요.`);
        }
      }
      if (step.booklet?.equationRole === 'key' && !step.latex.trim()) {
        issues.push(`${question.number}번 ${step.id}: 핵심 수식은 이 단계에 실제로 적힌 수식이 있을 때만 선택해주세요.`);
      }
      const invalidPhrases = step.booklet?.keyPhrases?.filter((phrase) => ![step.explanation, step.booklet?.takeaway?.trim() ?? ''].some((sourceText) => containsWholePhrase(sourceText, phrase))) ?? [];
      if (invalidPhrases.length) {
        issues.push(`${question.number}번 ${step.id}: 강조는 실제 문장의 연속 구절을 그대로 복사하고, 인라인 수식은 구분자까지 통째로 포함해주세요. 잘못 고른 구절은 ${invalidPhrases.map(mathFragment).join(', ')}입니다. 현재 설명은 ${mathFragment(step.explanation)}, 한 줄 정리는 ${mathFragment(step.booklet?.takeaway ?? '')}, 수식 주석(강조 대상 아님)은 ${mathFragment(step.booklet?.equationNote ?? '')}입니다. 설명 또는 한 줄 정리에서 실제 구절을 골라주세요.`);
      }
      if (supplement) for (const name of namedFunctions(text)) if (!allowed.has(name)) introduced.add(name);
      if (/별도\s*메모|(?:이|해당)\s*메모(?:는|가|를)|따로\s*적어\s*둔|제작\s*과정|AI가\s*작성|(?:사진|이미지)(?:의|에서)|원본(?:에\s*적힌|의\s*필기)|적힌\s*(?:식|접선\s*방정식)/u.test(text)) {
        issues.push(`${question.number}번 ${step.id}: 학생용 설명의 메모·제작 서술을 빼고 수학적 이유만 써주세요.`);
      }
      const plainAnswer = /[\p{Script=Hangul}\p{Script=Han}]/u.test(step.latex) && !/[\\=^_{}]/u.test(step.latex);
      const prefix = `${question.number}번 ${step.id}: 학생용 수식의 LaTeX 표기가 손상되었습니다.`;
      if (controlCharacters.test(step.latex) || (step.latex.trim() && !plainAnswer && safeMath(step.latex) === null)) {
        issues.push(`${prefix} 단계 수식(latex)의 오류 조각은 ${mathFragment(step.latex)}입니다. 수식 내용만 넣고 $, \\(\\), \\[\\] 구분자는 제거하며 허용된 명령을 써주세요.`);
      }
      const termFault = step.booklet?.termNotes?.find((note) => controlCharacters.test(note.term) || safeMath(note.term) === null);
      if (termFault) {
        issues.push(`${prefix} 항 주석(term)의 오류 조각은 ${mathFragment(termFault.term)}입니다. 수식 항만 넣고 구분자와 지원되지 않는 명령을 확인해주세요.`);
      }
      const inlineFault = inlineMathFault(studentFields(step, false));
      if (inlineFault) {
        issues.push(`${prefix} 설명·주석의 ${inlineFault.kind} 오류 조각은 ${mathFragment(inlineFault.fragment)}입니다. 명령과 구분자를 올바르게 써주세요.`);
      }
    }
    for (const name of introduced) issues.push(`${question.number}번: 원문에 없는 함수 ${name}를 새로 정의하거나 사용했습니다. 원문 식을 그대로 설명해주세요.`);
    const mathematicalTip = source.observedSteps.some((step) => /(?:\btip\s*[):：]|참고\s*[:：]|팁\s*[:：])/iu.test(step.text)
      && /[=′'∫]|함수|도함수|접선|그래프|계수/u.test(step.text));
    if (supplement && job.pdfDesign?.template === 'baeksin-v16' && mathematicalTip && !question.steps.some((step) => step.booklet?.referenceTip?.trim())) {
      issues.push(`${question.number}번: 원문의 수학 Tip을 해당 단계의 booklet.referenceTip에 짧은 수학 설명으로 담아주세요.`);
    }
  }
  return issues;
}
