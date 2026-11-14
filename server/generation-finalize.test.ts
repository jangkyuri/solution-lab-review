import { describe, expect, it } from 'vitest';
import { finalizeGeneration } from './generation-finalize.ts';
import { generatedFixture, exampleFixture, libraryFixture, readingFixture } from './generation-fixtures.ts';
import { validateSolutionStructure } from './generation-validation.ts';
import { GeneratedResultSchema } from './generation-schemas.ts';

describe('generation evidence and mode separation', () => {
  it('uses server-owned provenance and original problem text', () => {
    // Given
    const generated = generatedFixture();
    // When
    const result = finalizeGeneration(generated, readingFixture, 'solve', libraryFixture, [exampleFixture]);
    // Then
    expect(result.provenance).toEqual({ snapshotId: 'snapshot-1', capturedAt: '2026-11-06T00:00:00Z', sampleIds: ['P01'], exampleJobIds: [], mode: 'solve', evidenceStatus: 'observed_not_teacher_approved' });
    expect(result.questions[0]?.problemText).toBe(readingFixture.questions[0]?.problemText);
    expect(result.questions[0]?.steps[0]?.originalStep).toBe('');
    expect(result.references[0]?.title).toBe(exampleFixture.title);
  });

  it('restores the original handwriting transcription in supplement mode', () => {
    // Given
    const generated = generatedFixture();
    // When
    const result = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]);
    // Then
    expect(result.questions[0]?.steps[0]?.originalStep).toBe(readingFixture.questions[0]?.observedSteps[0]?.text);
    expect(result.questions[0]?.steps[0]?.explanation).toBe(generated.questions[0]?.steps[0]?.explanation);
  });

  it.each([
    [null, null, 'wide'],
    ['side', null, 'side'],
    ['small', null, 'small'],
    [null, { xMin: 0, xMax: 1, yMin: 0, yMax: 2 }, undefined],
  ] as const)('resolves the layout of a generated graph with figure=%s and zoom=%j', (figure, zoom, expectedFigure) => {
    // Given: the model supplies a graph, optionally with a size or an inset.
    const fixture = generatedFixture();
    const generated = GeneratedResultSchema.parse({
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question,
        steps: question.steps.map((step) => ({
          ...step,
          graph: {
            title: '', xMin: -2, xMax: 2, yMin: -1, yMax: 5, xLabel: 'x', yLabel: 'y',
            variable: 'x', qualitative: false, points: [], verticals: [], horizontals: [],
            arrows: [], shades: [], explanation: '',
            curves: [{ label: 'f(x)', expression: 'x^2', from: -2, to: 2, color: 'blue', dashed: false }],
          },
          booklet: figure || zoom ? {
            group: null, equationRole: null, keyPhrases: null, equationNote: null, takeaway: null,
            referenceTip: null, termNotes: null, graphLinks: null, table: null, figure, zoom, zoomNote: null,
          } : null,
        })),
      })),
    });

    // When: generation saves the solution.
    const step = finalizeGeneration(generated, readingFixture, 'solve', libraryFixture, [exampleFixture]).questions[0]?.steps[0];

    // Then: an unspecified main figure is wide, and intentional layouts remain available.
    expect(step?.booklet?.figure).toBe(expectedFigure);
    expect(step?.booklet?.zoom).toEqual(zoom ?? undefined);
  });

  it('preserves student layout from the model response while omitting null booklet fields', () => {
    // Given: the model returned student-only layout metadata without an observed source group.
    const fixture = generatedFixture();
    const studentLayout = {
      equationRole: 'key', keyPhrases: ['차분을 전개한다.'],
      referenceTip: '미분계수는 접선의 기울기와 같다.',
      termNotes: [{ term: '2x', note: '접선의 기울기를 뜻한다.', color: 'blue' }],
      figure: 'wide', zoom: { xMin: 0, xMax: 2, yMin: 0, yMax: 4 }, zoomNote: '같은 곡선의 일부를 확인한다.',
      table: [['구분', '판단'], ['도함수', '접선의 기울기']],
    };
    const generated = GeneratedResultSchema.parse({
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question,
        steps: question.steps.map((step) => ({
          ...step, booklet: { group: null, equationNote: null, takeaway: null, graphLinks: null, ...studentLayout },
        })),
      })),
    });

    // When: the supplement is normalized for storage.
    const result = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]);

    // Then: the student metadata survives, and the observed step stays authoritative.
    expect(result.questions[0]?.steps[0]?.booklet).toStrictEqual(studentLayout);
    expect(result.questions[0]?.steps[0]?.originalStep).toBe(readingFixture.questions[0]?.observedSteps[0]?.text);
  });

  it('retains the provisional reading and its step when the attachment shows a different sign', () => {
    const conflict = '사진에서는 두 항 사이에 더하기 부호가 보입니다.';
    const generated = generatedFixture();
    const draft = {
      ...generated,
      questions: generated.questions.map((question) => ({
        ...question,
        uncertainties: [conflict],
        steps: question.steps.map((step) => ({ ...step, sourceConflict: conflict })),
      })),
    };
    const question = finalizeGeneration(draft, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0];

    expect(question?.steps[0]).toMatchObject({
      id: 'S01', after: [], branch: null,
      originalStep: readingFixture.questions[0]?.observedSteps[0]?.text,
      sourceConflict: `[확인 필요] ${conflict}`,
    });
    expect(question?.uncertainties).toEqual([]);
  });

  it('keeps a verified calculation mismatch distinct from an ambiguous source mark', () => {
    const ambiguity = '첫 식 분모의 첨자가 흐려 확정할 수 없다.';
    const mismatch = String.raw`손풀이의 마지막 값은 \(x\)이고, 주어진 식에서 구한 도함수는 \(2x\)이다.`;
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const draft = generatedFixture();
    const question = draft.questions[0];
    const lastStep = source?.observedSteps[0];
    if (!source || !question || !lastStep) throw new Error('Missing fixture source or question.');
    source.uncertainties = [ambiguity];
    source.problemText += '\n① x\n② 2x';
    lastStep.text = 'x';
    question.answer = String.raw`② \(2x\)`;
    question.uncertainties = [`[확인 필요] ${mismatch}`];

    const stored = finalizeGeneration(draft, reading, 'supplement', libraryFixture, [exampleFixture]).questions[0];

    expect(stored?.problemText).toBe(source.problemText);
    expect(stored?.steps[0]?.originalStep).toBe('x');
    expect(stored?.steps[0]?.sourceConflict).toBeNull();
    expect(stored?.answer).toBe(question.answer);
    expect(stored?.uncertainties).toEqual([`[확인 필요] ${ambiguity}`, `[확인 필요] ${mismatch}`]);
  });

  it('allows a standard solution for an unmatched question in a handwriting job', () => {
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    if (!source) throw new Error('Missing fixture source.');
    source.handwritingStatus = 'missing';
    source.observedSteps = [];

    const question = finalizeGeneration(generatedFixture(), reading, 'supplement', libraryFixture, [exampleFixture]).questions[0];

    expect(question?.answer).toBe('2x');
    expect(question?.observedOrder).toEqual([]);
    expect(question?.steps[0]?.originalStep).toBe('');
    expect(question?.uncertainties).toEqual([]);
  });

  it('retains the warning and leaves unreadable handwriting without an invented sequence', () => {
    const reading = structuredClone(readingFixture);
    const source = reading.questions[0];
    const draft = generatedFixture();
    const question = draft.questions[0];
    if (!source || !question) throw new Error('Missing fixture source or question.');
    source.handwritingStatus = 'unreadable';
    source.observedSteps = [];
    source.uncertainties = ['손풀이의 첫 줄이 흐려 읽을 수 없다.'];
    question.steps = [];

    const stored = finalizeGeneration(draft, reading, 'supplement', libraryFixture, [exampleFixture]).questions[0];

    expect(stored?.answer).toBe('2x');
    expect(stored?.steps).toEqual([]);
    expect(stored?.uncertainties).toEqual(['[확인 필요] 손풀이의 첫 줄이 흐려 읽을 수 없다.']);
  });

  it('translates internal names in explanations and notes while keeping the literal reading', () => {
    const generated = generatedFixture();
    const draft = {
      ...generated,
      questions: generated.questions.map((question) => ({
        ...question,
        steps: question.steps.map((step) => ({ ...step, explanation: 'observedOrder를 확인합니다.' })),
        uncertainties: ['methodExamples를 대조합니다.'],
      })),
    };
    const question = finalizeGeneration(draft, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0];

    expect(question?.steps[0]?.explanation).toBe('원래 풀이 순서를 확인합니다.');
    expect(question?.uncertainties).toEqual(['[확인 필요] 참고 풀이 자료를 대조합니다.']);
    expect(question?.steps[0]?.originalStep).toBe(readingFixture.questions[0]?.observedSteps[0]?.text);
  });

  it('uses x값 and y값 in generated student text while preserving the source and TeX', () => {
    // Given: generated prose uses coordinate jargon, while the source and formula remain literal.
    const fixture = generatedFixture();
    const formula = String.raw`\text{가로좌표}=a,\quad y=\frac{1}{2}`;
    const generated = GeneratedResultSchema.parse({
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question,
        steps: question.steps.map((step) => ({
          ...step, latex: formula,
          explanation: String.raw`가로좌표가 같으므로 세로 좌표를 비교한다. \(\text{세로좌표}=b\)`,
          booklet: {
            group: null, equationRole: null, keyPhrases: null, takeaway: null, referenceTip: null,
            termNotes: null, graphLinks: null, figure: null, zoom: null, zoomNote: null,
            equationNote: '가로 값은 유지한다.', table: [['가로좌표', '세로좌표'], ['같다', '다르다']],
          },
        })),
      })),
    });

    // When: the real generation finalizer prepares the student result.
    const step = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0]?.steps[0];

    // Then: only generated prose changes; formula and original handwriting remain exact.
    expect(step?.explanation).toBe(String.raw`x값이 같으므로 y값을 비교한다. \(\text{세로좌표}=b\)`);
    expect(step?.booklet).toMatchObject({ equationNote: 'x값은 유지한다.', table: [['x값', 'y값'], ['같다', '다르다']] });
    expect(step?.latex).toBe(formula);
    expect(step?.originalStep).toBe(readingFixture.questions[0]?.observedSteps[0]?.text);
  });

  it('names the x축 and nonzero comparison lines from their actual graph heights', () => {
    // Given: two graph lines have the same generic label but different known y-values.
    const fixture = generatedFixture();
    const generated = GeneratedResultSchema.parse({
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question,
        steps: question.steps.map((step) => ({
          ...step,
          explanation: '수평선과의 교점을 비교한다.',
          graph: {
            title: '가로좌표 비교', xMin: -2, xMax: 2, yMin: -2, yMax: 4,
            xLabel: 'x', yLabel: 'y', variable: 'x', qualitative: false, arrows: [], shades: [],
            curves: [], points: [{ x: 1, y: 3, label: '세로좌표', open: false }],
            verticals: [{ x: 1, label: '가로좌표' }],
            horizontals: [{ y: 0, label: '수평선' }, { y: 3, label: '수평선' }],
            explanation: '가로 좌표가 같은 두 점을 비교한다.',
          },
        })),
      })),
    });

    // When: the real finalizer receives the graph with verified geometric heights.
    const step = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0]?.steps[0];

    // Then: a nonzero line never becomes the x-axis, and general prose stays mathematically valid.
    expect(step?.graph?.horizontals).toEqual([{ y: 0, label: 'x축' }, { y: 3, label: String.raw`직선 \(y=3\)` }]);
    expect(step?.graph?.points[0]?.label).toBe('y값');
    expect(step?.graph?.verticals[0]?.label).toBe('x값');
    expect(step?.explanation).toBe('x축과 평행한 직선과의 교점을 비교한다.');
  });

  it('does not turn an unattained bound into a maximum or change geometric lengths', () => {
    // Given: this description explicitly says the limiting value is not attained.
    const fixture = generatedFixture();
    const explanation = '상한은 3이지만 최댓값은 없다. 가로 길이는 2, 세로 길이는 4이다.';
    const generated = {
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question, steps: question.steps.map((step) => ({ ...step, explanation })),
      })),
    };

    // When: terminology is normalized without solving the problem again.
    const step = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0]?.steps[0];

    // Then: the normalizer does not invent attainment or reinterpret rectangle dimensions.
    expect(step?.explanation).toBe(explanation);
  });

  it('uses ordinary increase and decrease terms in student prose', () => {
    // Given: generated prose uses monotonicity jargon but the source is still authoritative.
    const fixture = generatedFixture();
    const generated = {
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question, steps: question.steps.map((step) => ({
          ...step, explanation: '단조구간에서 단조증가 또는 단조감소한다.',
        })),
      })),
    };

    // When: the finalizer prepares the generated student explanation.
    const step = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0]?.steps[0];

    // Then: only the terminology changes, without adding or removing a mathematical claim.
    expect(step?.explanation).toBe('증가·감소하는 구간에서 증가 또는 감소한다.');
  });

  it('keeps math labels literal and avoids duplicating coordinate suffixes', () => {
    // Given: a label contains literal TeX text, and prose already includes 값 after 좌표.
    const fixture = generatedFixture();
    const generated = GeneratedResultSchema.parse({
      ...fixture,
      questions: fixture.questions.map((question) => ({
        ...question,
        steps: question.steps.map((step) => ({
          ...step, explanation: '가로좌표값과 세로좌표값을 비교한다.',
          graph: {
            title: '', xMin: -1, xMax: 1, yMin: -1, yMax: 4, xLabel: 'x', yLabel: 'y',
            variable: 'x', qualitative: false, curves: [], points: [], verticals: [], arrows: [], shades: [], explanation: '',
            horizontals: [{ y: 3, label: String.raw`\(\text{수평선}\)` }, { y: 3, label: String.raw`수평선 \(y=3\)` }],
          },
        })),
      })),
    });

    // When: generated prose and graph labels pass through the finalizer.
    const step = finalizeGeneration(generated, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0]?.steps[0];

    // Then: literal math is intact and the label never gains a second equation.
    expect(step?.explanation).toBe('x값과 y값을 비교한다.');
    expect(step?.graph?.horizontals.map((line) => line.label)).toEqual([String.raw`\(\text{수평선}\)`, String.raw`x축과 평행한 직선 \(y=3\)`]);
  });

  it('bases the draft note on references actually used, regardless of available candidates', () => {
    const draft = { ...generatedFixture(), references: [] };
    const noCandidates = finalizeGeneration(draft, readingFixture, 'solve', libraryFixture, []);
    const unusedCandidate = finalizeGeneration(draft, readingFixture, 'solve', libraryFixture, [exampleFixture]);

    expect(unusedCandidate.limitations).toEqual(noCandidates.limitations);
    expect(unusedCandidate.provenance?.sampleIds).toEqual([]);
  });

  it('rejects a reference to a validation sample', () => {
    // Given
    const generated = { ...generatedFixture(), references: [{ id: 'V01', title: 'reserved', reason: '' }] };
    // When / Then
    expect(() => finalizeGeneration(generated, readingFixture, 'solve', libraryFixture, [exampleFixture])).toThrow();
  });

  it('rejects an extra invented question', () => {
    // Given
    const generated = { ...generatedFixture(), questions: [] };
    // When / Then
    expect(() => finalizeGeneration(generated, readingFixture, 'solve', libraryFixture, [exampleFixture])).toThrow();
  });

  it('rejects an empty result at the manual edit boundary', () => {
    // Given
    const result = finalizeGeneration(generatedFixture(), readingFixture, 'solve', libraryFixture, [exampleFixture]);
    // When / Then
    expect(() => validateSolutionStructure({ ...result, questions: [] })).toThrow();
  });
});
