import { describe, expect, it } from 'vitest';
import { generatedFixture, jobFixture, readingFixture } from './generation-fixtures.ts';
import { generationQualityIssues } from './generation-quality.ts';
import { GraphSchema } from '../shared/contracts.ts';

const supplementJob = { ...jobFixture, mode: 'supplement' } as const;
const baeksinJob = { ...supplementJob, pdfDesign: { fontSize: 11, margins: 'standard', stepLayout: 'flow', template: 'baeksin-v16' } } as const;
const emptyBooklet = { group: null, equationRole: null, keyPhrases: null, equationNote: null, takeaway: null, referenceTip: null, termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null } as const;

describe('student supplement generation quality', () => {
  it('rejects a new helper function even when the declared variables are unchanged', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = 'h(x)=x^2이라 두면 h′(x)=2x입니다.';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toContain('1번: 원문에 없는 함수 h를 새로 정의하거나 사용했습니다. 원문 식을 그대로 설명해주세요.');
    step.explanation = 'f′(x)=2x입니다.';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toEqual([]);
    expect(generationQualityIssues(jobFixture, readingFixture, generated)).toEqual([]);
  });

  it('requires a reference box for an explicitly labeled mathematical source tip', () => {
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    if (!source) throw new Error('Missing fixture question.');
    source.observedSteps[0] = { id: 'S01', text: 'Tip) y절편=f(t)-tf′(t)', after: [], branch: null };
    const generated = generatedFixture();
    const job = { ...supplementJob, pdfDesign: { fontSize: 11, margins: 'standard', stepLayout: 'flow', template: 'baeksin-v16' } } as const;
    expect(generationQualityIssues(job, reading, generated)).toContain('1번: 원문의 수학 Tip을 해당 단계의 booklet.referenceTip에 짧은 수학 설명으로 담아주세요.');
  });

  it('accepts a source variable followed by parentheses as algebraic multiplication', () => {
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!source || !step) throw new Error('Missing fixture question or step.');
    source.problemText = 'f(x)=x²−x';
    source.variables = ['x', 'f(x)'];
    source.observedSteps = [];
    step.explanation = 'x(x−1)로 인수분해합니다.';
    expect(generationQualityIssues(supplementJob, reading, generated)).toEqual([]);
  });

  it('checks student text without rejecting source transcription and review evidence', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.originalStep = '이 메모는 따로 적어 둔 것입니다.';
    step.evidence = '이 메모는 원본에서 읽었습니다.';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toEqual([]);
    step.explanation = '이 메모는 본 풀이와 분리해 적어 둔 것입니다.';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toContain('1번 S01: 학생용 설명의 메모·제작 서술을 빼고 수학적 이유만 써주세요.');
  });

  it.each(['사진의 미분 결과를 이용합니다.', '즉 적힌 접선 방정식을 대입합니다.'])('rejects source qualifiers in student prose (%s)', (text) => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = text;
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toContain('1번 S01: 학생용 설명의 메모·제작 서술을 빼고 수학적 이유만 써주세요.');
  });

  it('rejects an actual tab from a misescaped inline command without rewriting the result', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    const damaged = '\\(e-\text{−}0=e\\)';
    step.explanation = damaged;
    expect(damaged).toContain('\t');
    expect(generationQualityIssues(supplementJob, readingFixture, generated).some((issue) => issue.includes('학생용 수식의 LaTeX 표기가 손상'))).toBe(true);
    expect(step.explanation).toBe(damaged);
    step.explanation = '분수 \\(\\frac{1}{2}\\)와 줄바꿈을\n유지합니다.';
    step.latex = '\\begin{aligned}f(x)&=x^2\\\\\nf\'(x)&=2x\\end{aligned}';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toEqual([]);
    step.latex = '최댓값은 5';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toEqual([]);
  });

  it.each([
    '\\max_{0\\le x\\le 2}f(x)', '\\min _{[0,2]} f(x)',
    '\\max\\limits_{0\\le x\\le 2}f(x)', '\\min \\limits _x f(x)',
    '\\operatorname{max}_{[0,2]}f(x)', '\\operatorname* { min } \\limits_{[0,2]}f(x)',
    'MAX_{[0,2]} f(x)',
  ])('rejects bounded extremum notation in newly generated student text (%s)', (notation) => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.latex = notation;
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toContain('1번: 최댓값·최솟값은 범위를 붙인 max/min 표기 대신 한글과 실제 함숫값 비교로 설명해주세요. 범위 조건은 본문에 유지해주세요.');
    expect(generationQualityIssues(jobFixture, readingFixture, generated)).toContain('1번: 최댓값·최솟값은 범위를 붙인 max/min 표기 대신 한글과 실제 함숫값 비교로 설명해주세요. 범위 조건은 본문에 유지해주세요.');
  });

  it('checks a reference note while retaining source notation and the mathematical domain', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.booklet = { group: null, equationRole: null, keyPhrases: null, equationNote: null, takeaway: null, referenceTip: '\\(\\max_{[0,2]} f(x)\\)', termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null };
    expect(generationQualityIssues(supplementJob, readingFixture, generated).some((issue) => issue.includes('범위를 붙인 max/min'))).toBe(true);
    step.booklet = null;
    step.originalStep = '\\max_{[0,2]} f(x)';
    step.evidence = '\\max_{[0,2]} f(x)';
    step.explanation = '닫힌구간 \\([0,2]\\)에서 \\(f(0),f(2)\\)를 비교한다.';
    step.latex = '\\max(3,5)=5';
    expect(generationQualityIssues(supplementJob, readingFixture, generated)).toEqual([]);
  });

  it.each(['normal', 'key'] as const)('accepts optional equation emphasis when the first step is %s', (equationRole) => {
    const generated = generatedFixture();
    const question = generated.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing fixture question or step.');
    question.steps.push({ ...step, id: 'S02', after: ['S01'] });
    step.booklet = { ...emptyBooklet, equationRole, keyPhrases: ['차분을 전개한다.'] };
    expect(generationQualityIssues(baeksinJob, readingFixture, generated)).toEqual([]);
  });

  it.each([2, 3])('rejects %i key equations without rewriting the generated result', (count) => {
    const generated = generatedFixture();
    const question = generated.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing fixture question or step.');
    step.booklet = { ...emptyBooklet, equationRole: 'key', keyPhrases: ['차분을 전개한다.'] };
    for (let index = 1; index < count; index += 1) {
      question.steps.push({ ...step, id: `S0${index + 1}`, after: [`S0${index}`], booklet: { ...emptyBooklet, equationRole: 'key' } });
    }
    const original = structuredClone(generated);
    expect(generationQualityIssues(baeksinJob, readingFixture, generated)).toHaveLength(1);
    expect(generated).toEqual(original);
  });

  it.each([0, 4])('retains the existing phrase density limits when %i phrases are selected', (count) => {
    const generated = generatedFixture();
    const question = generated.questions[0];
    const step = question?.steps[0];
    if (!question || !step) throw new Error('Missing fixture question or step.');
    const keyPhrases = count === 0 ? [] : ['차분', '전개한다.'];
    step.booklet = { ...emptyBooklet, keyPhrases };
    question.steps.push({ ...step, id: 'S02', after: ['S01'] });
    expect(generationQualityIssues(baeksinJob, readingFixture, generated)).toHaveLength(1);
  });

  it('requires exact emphasis spans and keeps an inline formula whole', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = '점 \\(x,f(x)\\)에서 기울기를 읽는다.';
    step.booklet = { ...emptyBooklet, keyPhrases: ['f(x)'] };
    expect(generationQualityIssues(baeksinJob, readingFixture, generated).some((issue) => issue.includes('실제 문장의 연속 구절'))).toBe(true);
    step.booklet.keyPhrases = ['없는 판단'];
    expect(generationQualityIssues(baeksinJob, readingFixture, generated).some((issue) => issue.includes('실제 문장의 연속 구절'))).toBe(true);
    step.booklet.keyPhrases = ['점 \\(x,f(x)\\)'];
    expect(generationQualityIssues(baeksinJob, readingFixture, generated)).toEqual([]);
  });

  it('keeps tangent-height and absolute-distance visuals distinct when numeric formulas support both', () => {
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const question = generated.questions[0];
    const step = question?.steps[0];
    if (!source || !question || !step) throw new Error('Missing fixture question or step.');
    source.problemText = '함수 f(t)=t²+1 위의 점 (x,f(x))에서의 접선이 y축과 만나는 점까지의 거리를 구하여라.';
    const scene = (expression: string) => GraphSchema.parse({
      title: '높이와 거리', xMin: -2, xMax: 2, yMin: -4, yMax: 5, xLabel: 'x', yLabel: 'y',
      curves: [{ label: expression, expression, color: 'blue', from: -2, to: 2, dashed: false, samples: [] }],
      points: [], verticals: [], explanation: '식의 값을 읽는다.',
    });
    step.graph = scene('abs(1-x^2)');
    expect(generationQualityIssues(supplementJob, reading, generated).some((issue) => issue.includes('접선의 높이·거리 관계와 절댓값 변환'))).toBe(true);
    question.steps.push({ ...step, id: 'S02', after: ['S01'], graph: scene('abs( 1 - x^2 )') });
    expect(generationQualityIssues(supplementJob, reading, generated).some((issue) => issue.includes('접선의 높이·거리 관계와 절댓값 변환'))).toBe(true);
    const second = question.steps[1];
    if (!second) throw new Error('Missing second fixture step.');
    second.graph = scene('1-x^2');
    expect(generationQualityIssues(supplementJob, reading, generated)).toEqual([]);
    source.problemText = '주어진 다항식을 정리하여라.';
    question.steps.pop();
    expect(generationQualityIssues(supplementJob, reading, generated)).toEqual([]);
  });

  it.each(['\\[x^2\\]', '$x^2$', '\\unknown{x}'])('identifies the exact bad display formula without relaxing the whitelist (%s)', (formula) => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.latex = formula;
    const issue = generationQualityIssues(supplementJob, readingFixture, generated).find((item) => item.includes('LaTeX 표기가 손상'));
    expect(issue).toContain('단계 수식(latex)');
    expect(issue).toContain(JSON.stringify(formula));
    expect(issue).toContain('수식 내용만');
  });

  it('identifies a bad inline fragment and escapes a control character in a term note', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = '수식 \\(\\unknown{x}\\)을 읽는다.';
    let issue = generationQualityIssues(supplementJob, readingFixture, generated).find((item) => item.includes('LaTeX 표기가 손상'));
    expect(issue).toContain('인라인 수식');
    expect(issue).toContain(JSON.stringify('\\(\\unknown{x}\\)'));
    step.explanation = '수식 \\(x+1을 읽는다.';
    issue = generationQualityIssues(supplementJob, readingFixture, generated).find((item) => item.includes('LaTeX 표기가 손상'));
    expect(issue).toContain('닫히지 않은');
    step.explanation = '';
    step.booklet = { ...emptyBooklet, termNotes: [{ term: '\u001bx', note: '항의 의미', color: 'blue' }] };
    issue = generationQualityIssues(supplementJob, readingFixture, generated).find((item) => item.includes('LaTeX 표기가 손상'));
    expect(issue).toContain('항 주석(term)');
    expect(issue).toContain('\\u001b');
    expect(issue).not.toContain('\u001b');
  });
});
