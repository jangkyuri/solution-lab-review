import { describe, expect, it } from 'vitest';
import { GraphSchema } from '../shared/contracts.ts';
import { generatedFixture, jobFixture, readingFixture } from './generation-fixtures.ts';
import { generationQualityIssues } from './generation-quality.ts';

function fixture() {
  const reading = structuredClone(readingFixture);
  const source = reading.questions[0];
  const generated = generatedFixture();
  const question = generated.questions[0];
  const step = question?.steps[0];
  if (!source || !question || !step) throw new Error('Missing fixture step.');
  source.problemText = '함수 \\(f(x)=|x^2+k|\\)의 그래프와 직선 \\(y=a\\)가 만나는 서로 다른 점의 개수가 홀수인 조건에서 \\(k\\)의 값은?';
  source.variables = ['x', 'f', 'k', 'a', 'y'];
  question.variables = [...source.variables];
  question.answer = 'k=-1';
  step.graph = GraphSchema.parse({
    title: '기본 곡선', xMin: -2, xMax: 2, yMin: 0, yMax: 4, xLabel: 'x', yLabel: 'y',
    curves: [{ label: '기본 곡선', expression: 'x^2', color: 'blue', from: -2, to: 2, dashed: false, samples: [] }],
    points: [], verticals: [], explanation: '곡선을 읽는다.',
  });
  return { reading, generated, question, step };
}

describe('actual target visual coverage and concise prose', () => {
  it('requires the resolved absolute-value target and horizontal comparison within one sufficient scene', () => {
    const data = fixture();
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated).some((issue) => issue.includes('실제 절댓값 대상'))).toBe(true);
    if (!data.step.graph || !data.step.graph.curves[0]) throw new Error('Missing graph fixture.');
    data.step.graph.curves[0].expression = 'abs(x^2-1)';
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated).some((issue) => issue.includes('실제 절댓값 대상'))).toBe(true);
    data.step.graph.horizontals = [{ y: 1, label: '비교 높이' }];
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated)).toEqual([]);
  });

  it('does not demand invented numeric target plots while parameters or exact curves remain unsupported', () => {
    const data = fixture();
    data.question.answer = 'k';
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated)).toEqual([]);
    data.question.answer = 'k=-1';
    if (!data.step.graph) throw new Error('Missing graph fixture.');
    data.step.graph.qualitative = true;
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated)).toEqual([]);
  });

  it('does not treat a numeric intersection-count answer as a resolved target parameter', () => {
    const data = fixture();
    const source = data.reading.questions[0];
    if (!source) throw new Error('Missing source fixture.');
    source.problemText = '함수 \\(f(x)=|x^2+k|\\)의 그래프와 직선 \\(y=1\\)이 만나는 서로 다른 점의 최대 개수는?';
    data.question.answer = '4';
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated)).toEqual([]);
  });

  it('skips the deterministic numeric plot demand when another target symbol remains unresolved', () => {
    const data = fixture();
    const source = data.reading.questions[0];
    if (!source) throw new Error('Missing source fixture.');
    source.problemText = source.problemText.replace('x^2+k', 'x^2+k+m');
    expect(generationQualityIssues({ mode: 'supplement' }, data.reading, data.generated)).toEqual([]);
  });

  it('allows three short necessary explanation sentences without weakening the other student checks', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    const job = { ...jobFixture, mode: 'supplement', pdfDesign: { fontSize: 11, margins: 'standard', stepLayout: 'flow', template: 'baeksin-v16' } } as const;
    step.explanation = '차분을 전개한다. 분모와 분자에 공통인 증가량은 0이 아니므로 약분한다. 그다음 증가량을 0에 가까이 보내 도함수를 구한다.';
    expect(generationQualityIssues(job, readingFixture, generated)).toEqual([]);
    step.explanation += ' 사진의 식이다.';
    expect(generationQualityIssues(job, readingFixture, generated).some((issue) => issue.includes('메모·제작 서술'))).toBe(true);
  });

  it('identifies the invalid highlight and the actual available text without changing it', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing step fixture.');
    step.explanation = '실제 설명 문장이다.';
    step.booklet = { group: null, equationRole: null, keyPhrases: ['없는 강조'], equationNote: '실제 수식 주석이다.', takeaway: '실제 한 줄 정리이다.', referenceTip: null, termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null };
    const issue = generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).find((item) => item.includes('실제 문장의 연속 구절'));
    expect(issue).toContain(JSON.stringify('없는 강조'));
    expect(issue).toContain(JSON.stringify(step.explanation));
    expect(issue).toContain(JSON.stringify(step.booklet.takeaway));
    expect(issue).toContain(JSON.stringify(step.booklet.equationNote));
    expect(step.booklet.keyPhrases).toEqual(['없는 강조']);
  });
});
