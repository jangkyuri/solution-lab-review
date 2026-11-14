import { describe, expect, it } from 'vitest';
import { GraphSchema } from '../shared/contracts.ts';
import { finalizeGeneration } from './generation-finalize.ts';
import { generatedFixture, exampleFixture, libraryFixture, readingFixture } from './generation-fixtures.ts';
import { generationQualityIssues } from './generation-quality.ts';
import { prepareGraphs } from './graphs.ts';

describe('derived visuals at existing source steps', () => {
  it('asks for a correction when a problem explicitly requires drawing a graph', () => {
    const reading = structuredClone(readingFixture);
    const generated = generatedFixture();
    const source = reading.questions[0];
    const question = generated.questions[0];
    if (!source || !question) throw new Error('Missing fixture question.');
    source.problemText = '함수 \\(f(x)=x^3-3x^2+2\\)의 그래프를 그려 교점의 개수를 구하시오.';
    question.steps = question.steps.map(step => ({ ...step, graph: null }));

    expect(generationQualityIssues({ mode: 'solve' }, reading, generated)).toContainEqual(
      expect.stringContaining('문제에서 그리라고 한 그래프가 빠졌습니다.'),
    );
  });

  it('retains a grounded point-only diagram added to an unillustrated step and samples the later distance curve', async () => {
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const question = generated.questions[0];
    const first = question?.steps[0];
    if (!source || !question || !first) throw new Error('Missing fixture question or step.');
    source.problemText = '함수 f(x)=x²+1에서 t의 접선과 y축의 교점 P까지의 거리를 g(t)라 하자. −2≤t≤2이다.';
    source.variables = ['x', 't', 'f', 'P', 'g'];
    source.observedSteps = [
      { id: 'S01', text: 'y절편=f(t)−tf′(t). t=0에서 P=(0,1).', after: [], branch: null },
      { id: 'S02', text: 'g(t)=|1−t²|', after: ['S01'], branch: null },
    ];
    source.visualObservations = ['S01에는 그림이 없고 S02에 거리 그래프가 있다.'];
    const height = GraphSchema.parse({
      title: '높이와 거리', xMin: -1, xMax: 1, yMin: 0, yMax: 2, xLabel: 'x', yLabel: 'y',
      curves: [], points: [{ x: 0, y: 1, label: 'P', open: false }], verticals: [],
      arrows: [{ from: { x: 0, y: 0 }, to: { x: 0, y: 1 }, label: '거리' }],
      explanation: '점의 높이와 원점에서의 거리를 연결한다.',
    });
    const distance = GraphSchema.parse({
      title: '거리 함수', variable: 't', xMin: -2, xMax: 2, yMin: 0, yMax: 4, xLabel: 't', yLabel: 'g(t)',
      curves: [{ label: 'g(t)', expression: 'abs(1-t^2)', color: 'blue', from: -2, to: 2, dashed: false, samples: [] }],
      points: [], verticals: [], explanation: '거리의 식을 같은 구간에서 읽는다.',
    });
    question.variables = [...source.variables];
    question.answer = '|1−t²|';
    question.steps = [
      { ...first, id: 'S01', after: [], latex: 'f(0)=1', explanation: '점 P의 높이는 원점에서의 거리와 같다.', graph: height },
      { ...first, id: 'S02', after: ['S01'], latex: 'g(t)=|1-t^2|', explanation: '', graph: distance },
    ];
    expect(generationQualityIssues({ mode: 'supplement' }, reading, generated)).toEqual([]);
    const result = finalizeGeneration(generated, reading, 'supplement', libraryFixture, [exampleFixture]);
    const prepared = await prepareGraphs(result);
    const steps = prepared.questions[0]?.steps;
    expect(steps?.map((step) => [step.id, step.after])).toEqual([['S01', []], ['S02', ['S01']]]);
    expect(steps?.[0]?.originalStep).toBe(source.observedSteps[0]?.text);
    expect(steps?.[0]?.graph?.curves).toEqual([]);
    expect(steps?.[0]?.graph?.points).toEqual(height.points);
    expect(steps?.[0]?.graph?.arrows).toEqual(height.arrows);
    expect(steps?.[1]?.graph?.curves[0]?.segments).toHaveLength(1);
    expect(steps?.[1]?.graph?.curves[0]?.samples.length).toBeGreaterThan(3);
  });
});
