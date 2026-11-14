import { describe, expect, it } from 'vitest';
import { DEFAULT_PDF_DESIGN } from '../shared/pdf-design.ts';
import { generatedFixture, jobFixture, readingFixture } from './generation-fixtures.ts';
import { generationQualityIssues } from './generation-quality.ts';

const referenceJob = { ...jobFixture, mode: 'supplement', pdfDesign: DEFAULT_PDF_DESIGN } as const;
const emptyBooklet = {
  group: null, equationRole: null, keyPhrases: null, equationNote: null, takeaway: null,
  referenceTip: null, termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null, table: null,
} as const;

describe('compact student reference quality', () => {
  it.each(['상한은 3이지만 최댓값은 없다.', '하한은 0에 가까워질 뿐이다.'])('requests a plain explanation of bounds without inventing an attained value (%s)', (explanation) => {
    // Given: a newly written explanation uses bound terminology.
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = explanation;

    // When: the quality gate inspects the new student text.
    const issues = generationQualityIssues(referenceJob, readingFixture, generated);

    // Then: regeneration is requested, leaving mathematical attainment for the generator to explain.
    expect(issues.some((issue) => issue.includes('상한·하한 대신'))).toBe(true);
    expect(step.explanation).toBe(explanation);
  });

  it('rejects definite source-error claims hidden in calculation checks when reading is uncertain', () => {
    // Given: a fuzzy digit is reported as uncertain, then later classified as a definite teacher error.
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const question = generated.questions[0];
    if (!source || !question) throw new Error('Missing fixture question.');
    source.uncertainties = ['분자가 흐려 확정할 수 없다.'];
    question.checks.math = ['독립 계산으로 원래 필기의 분자 오류를 확정했다.'];

    // When: all generation claims are checked, including diagnostic records.
    const issues = generationQualityIssues(referenceJob, reading, generated);

    // Then: a check record cannot upgrade uncertain handwriting to a definite error.
    expect(issues.some((issue) => issue.includes('판독이 불확실한 필기를 계산 오류로 단정'))).toBe(true);
  });

  it.each(['함수식으로 계산한 분자는 3이다.', '원문 필기의 오류인지 확정할 수 없다.'])('allows an independent calculation or a qualified source claim (%s)', (claim) => {
    // Given: the source remains uncertain and the check does not assign a definite teacher error.
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const question = generated.questions[0];
    if (!source || !question) throw new Error('Missing fixture question.');
    source.uncertainties = ['분자가 흐려 확정할 수 없다.'];
    question.checks.math = [claim];

    // When: the certainty guard checks the diagnostic record.
    const issues = generationQualityIssues(referenceJob, reading, generated);

    // Then: mathematical calculation and explicit uncertainty are not blocked.
    expect(issues).toEqual([]);
  });

  it.each(['조건을 만족하는 집합의 원소를 고른다.', String.raw`k\in\{a,b\}`])('requests direct conditions instead of new set language (%s)', (value) => {
    // Given: new student text introduces a set-theory description or membership notation.
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = value;

    // When: the finished reference format is checked.
    const issues = generationQualityIssues(referenceJob, readingFixture, generated);

    // Then: the generator must express the actual alternatives or simultaneous conditions directly.
    expect(issues.some((issue) => issue.includes('집합 용어나 기호 대신'))).toBe(true);
  });

  it('allows set reasoning in the course that teaches sets', () => {
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.explanation = String.raw`두 조건을 모두 만족하므로 교집합은 \(\{2\}\)이다.`;

    const issues = generationQualityIssues({ ...referenceJob, subject: '공통수학2' }, readingFixture, generated);

    expect(issues).toEqual([]);
  });

  it('preserves set wording in the original problem and handwriting without copying it into the supplement', () => {
    // Given: set notation occurs only in preserved source material and provenance evidence.
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!source || !step) throw new Error('Missing fixture source or step.');
    source.problemText = String.raw`집합 \(A=\{1,2\}\)에 대하여`;
    step.originalStep = String.raw`k\in\{a,b\}`;
    step.evidence = '집합 표시를 그대로 읽었다.';
    step.explanation = '가능한 값은 두 가지이다.';

    // When: only newly written student material is checked.
    const issues = generationQualityIssues(referenceJob, reading, generated);

    // Then: the input remains intact and no terminology revision is requested for the source.
    expect(issues).toEqual([]);
  });

  it('requests revision when a table repeats only the already displayed calculation', () => {
    // Given: this is the same derivative equation shown once as math and once as a two-column table.
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.latex = String.raw`f^{\prime}(x)=2x`;
    step.booklet = { ...emptyBooklet, table: [['식', '결과'], [String.raw`\(f^{\prime}(x)\)`, String.raw`\(2x\)`]] };
    const before = structuredClone(generated);

    // When: the real pre-publication generation checks inspect the compact reference.
    const issues = generationQualityIssues(referenceJob, readingFixture, generated);

    // Then: generation must revise the redundant presentation; the checker does not edit the draft.
    expect(issues.some((issue) => issue.includes('이미 제시한 식을 표에 반복'))).toBe(true);
    expect(generated).toEqual(before);
  });

  it('allows a table that compares new conditions rather than copying an equation', () => {
    // Given: this table carries a condition and a consequence missing from the displayed calculation.
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!step) throw new Error('Missing fixture step.');
    step.booklet = { ...emptyBooklet, table: [['조건', '판단'], [String.raw`\(x>0\)`, '증가']] };

    // When: the compact reference is checked.
    const issues = generationQualityIssues(referenceJob, readingFixture, generated);

    // Then: a useful comparison remains allowed.
    expect(issues).toEqual([]);
  });

  it('keeps unclear handwriting separate from a confirmed calculation error', () => {
    // Given: the source explicitly marks a handwritten value as uncertain.
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const generated = generatedFixture();
    const step = generated.questions[0]?.steps[0];
    if (!source || !step) throw new Error('Missing fixture source or step.');
    source.uncertainties = ['분자의 필획이 흐려 수치를 확정할 수 없다.'];
    step.evidence = '판독 차이가 아니라 계산 오류로 처리했다.';

    // When: the draft classifies the uncertain reading as a definite teacher error.
    const issues = generationQualityIssues(referenceJob, reading, generated);

    // Then: the generator must distinguish the reading from its own independently calculated value.
    expect(issues.some((issue) => issue.includes('판독이 불확실한 필기를 계산 오류로 단정'))).toBe(true);
  });

  it('allows independent mathematical calculation while source digits remain uncertain', () => {
    // Given: the source is unclear, but the explanation states only the calculation supported by the formula.
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    if (!source) throw new Error('Missing fixture source.');
    source.uncertainties = ['분자의 필획이 흐려 수치를 확정할 수 없다.'];

    // When: the draft is checked without a definite source-error claim.
    const issues = generationQualityIssues(referenceJob, reading, generatedFixture());

    // Then: uncertain transcription does not prevent independently justified mathematics.
    expect(issues).toEqual([]);
  });
});
