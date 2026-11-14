import type { Graph } from '../shared/contracts.ts';
import type { GeneratedResult } from './generation-schemas.ts';
import { graphNumber } from './pdf-graph-labels.ts';

const INLINE_MATH = /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/gu;
const PARTICLES: Readonly<Record<string, string>> = { 가: '이', 를: '을', 와: '과', 로: '으로', 는: '은' } as const;

function coordinateWord(direction: string, particle: string | undefined): string {
  const ending = particle ?? '';
  const adjusted = PARTICLES[ending] ?? ending;
  return `${direction === '가로' ? 'x' : 'y'}값${adjusted}`;
}

function normalizeProse(text: string): string {
  return text
    .replace(/\bobservedOrder\b/gu, '원래 풀이 순서')
    .replace(/\bmethodExamples\b/gu, '참고 풀이 자료')
    .replace(/(가로|세로)\s*좌표(?:\s*값)?(가|를|와|로|는)?/gu, (_match, direction: string, particle: string | undefined) => coordinateWord(direction, particle))
    .replace(/가로\s*값/gu, 'x값')
    .replace(/세로\s*값/gu, 'y값')
    .replace(/단조\s*구간/gu, '증가·감소하는 구간')
    .replace(/단조\s*증가/gu, '증가')
    .replace(/단조\s*감소/gu, '감소')
    .replace(/상한(?:값)?\s*\(최댓값\)/gu, '최댓값')
    .replace(/하한(?:값)?\s*\(최솟값\)/gu, '최솟값')
    .replace(/(?:판정\s*)?수평선/gu, 'x축과 평행한 직선');
}

export function studentFacingText(text: string): string {
  return text.split(INLINE_MATH).map((part, index) => index % 2 === 0 ? normalizeProse(part) : part).join('');
}

type GeneratedGraph = NonNullable<GeneratedResult['questions'][number]['steps'][number]['graph']>;

export function studentFacingGraph(graph: GeneratedGraph): Graph {
  return {
    ...graph,
    title: studentFacingText(graph.title),
    explanation: studentFacingText(graph.explanation),
    xLabel: studentFacingText(graph.xLabel),
    yLabel: studentFacingText(graph.yLabel),
    curves: graph.curves.map((curve) => ({ ...curve, label: studentFacingText(curve.label), samples: [], segments: [] })),
    points: graph.points.map((point) => ({ ...point, label: studentFacingText(point.label) })),
    verticals: graph.verticals.map((line) => ({ ...line, label: studentFacingText(line.label) })),
    horizontals: graph.horizontals.map((line) => ({
      ...line,
      label: /^(?:판정\s*)?수평선$/u.test(line.label.trim())
        ? line.y === 0 ? 'x축' : `직선 \\(y=${graphNumber(line.y)}\\)`
        : studentFacingText(line.label),
    })),
    arrows: graph.arrows.map((arrow) => ({ ...arrow, label: studentFacingText(arrow.label) })),
    shades: graph.shades.map((shade) => ({ ...shade, label: studentFacingText(shade.label) })),
  };
}
