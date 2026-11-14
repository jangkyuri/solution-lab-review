import { describe, expect, it } from 'vitest';
import { ResultSchema } from '../shared/contracts.ts';
import type { SolutionResult } from '../shared/contracts.ts';
import { prepareEditedResult } from './result-editing.ts';

function fixture(): SolutionResult {
  return ResultSchema.parse({
    summary: '원래 풀이', limitations: [], references: [{ id: 'P01', title: '근거', reason: '원래 선택' }],
    provenance: { snapshotId: 'server-snapshot', capturedAt: '2026-11-06T00:00:00Z', sampleIds: ['P01'], exampleJobIds: [], mode: 'supplement', evidenceStatus: 'observed_not_teacher_approved' },
    questions: [{
      number: '1', problemText: '직선 y=x의 함숫값을 구하시오.', firstDecision: '주어진 식을 확인한다.',
      variables: ['x', 'y'], observedOrder: ['원문 식', '대입'], answer: '2', uncertainties: [],
      checks: { math: ['이전 식 확인'], sequence: ['원문 순서 확인'], graph: ['이전 그래프 확인'] },
      steps: [{
        id: 'S01', title: '식', latex: 'y=x', originalStep: 'y=x', explanation: '원문 설명', evidence: '손풀이 첫 줄',
        after: [], branch: 'parallel_condition_b', sourceIssueRefs: [],
        graph: { title: '직선', xMin: 0, xMax: 2, yMin: 0, yMax: 5, xLabel: 'x', yLabel: 'y', explanation: '함숫값 대응',
          points: [], verticals: [], curves: [{ label: 'y=x', expression: 'x', color: 'blue', from: 0, to: 2, dashed: false,
            samples: [{ x: 0, y: 0 }, { x: 2, y: 2 }], segments: [[{ x: 0, y: 0 }, { x: 2, y: 2 }]] }] },
      }, {
        id: 'S02', title: '대입', latex: 'y=2', originalStep: 'x=2를 대입', explanation: '같은 식을 사용한다.', evidence: '손풀이 둘째 줄',
        after: ['S01'], branch: 'main_join', sourceIssueRefs: [], graph: null,
      }],
    }],
  });
}

const sourceConflict = '사진의 대입값은 3으로 보입니다.';
const sourceWarning = `S02 단계 원문 판독 확인이 필요합니다. ${sourceConflict}`;
const unrelatedWarning = 'S02 단계 원문 판독 확인이 필요합니다. 다른 조건은 별도 검토가 필요합니다.';

function conflictFixture(): SolutionResult {
  const result = fixture();
  const question = result.questions[0];
  const step = question?.steps[1];
  if (question && step) {
    step.sourceConflict = sourceConflict;
    step.graph = structuredClone(question.steps[0]?.graph ?? null);
    question.uncertainties = [sourceWarning, unrelatedWarning];
  }
  return result;
}

describe('review result editing', () => {
  it('recomputes changed graph expressions rather than retaining supplied finite samples', async () => {
    // Given a reviewed line and a changed expression with deliberately stale numerical samples.
    const previous = fixture();
    const edited = structuredClone(previous);
    const curve = edited.questions[0]?.steps[0]?.graph?.curves[0];
    if (curve) curve.expression = '2*x';
    // When the mathematical edit is prepared through the real Python sampler.
    const result = await prepareEditedResult(previous, edited);
    // Then the new segments use the changed expression, not the submitted old samples.
    const preparedCurve = result.questions[0]?.steps[0]?.graph?.curves[0];
    expect(preparedCurve?.segments.at(-1)?.at(-1)).toEqual({ x: 2, y: 4 });
    expect(result.questions[0]?.checks).toEqual({ math: [], sequence: [], graph: [] });
  }, 60_000);

  it('removes an unchanged old graph after its associated formula changes', async () => {
    // Given a formula change without a corresponding graph scene update.
    const previous = fixture();
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (step) step.latex = 'y=2x';
    // When the edit is saved.
    const result = await prepareEditedResult(previous, edited);
    // Then no stale graph is displayed and the source sequence fields remain intact.
    expect(result.questions[0]?.steps[0]).toMatchObject({ graph: null, originalStep: 'y=x', after: [], branch: 'parallel_condition_b' });
    expect(result.questions[0]?.uncertainties.length).toBeGreaterThan(0);
    expect(result.questions[0]?.checks).toEqual({ math: [], sequence: [], graph: [] });
  });

  it('requires a newly supplied figure recipe to pass the renderer before saving', async () => {
    const previous = fixture();
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (!step) throw new Error('Missing step fixture.');
    step.figureRecipe = '{"schema":"figure_recipe_v1","unknown":true}';
    await expect(prepareEditedResult(previous, edited)).rejects.toThrow('그래프 레시피를 그리지 못했습니다.');
  }, 60_000);

  it('keeps a saved recipe and requests graph review when its formula is edited', async () => {
    const previous = fixture();
    const original = previous.questions[0]?.steps[0];
    if (!original) throw new Error('Missing step fixture.');
    original.graph = null;
    original.figureRecipe = '{"schema":"figure_recipe_v1"}';
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (!step) throw new Error('Missing step fixture.');
    step.latex = 'y=2x';
    const result = await prepareEditedResult(previous, edited);
    expect(result.questions[0]?.steps[0]?.figureRecipe).toBe(original.figureRecipe);
    expect(result.questions[0]?.uncertainties).toContainEqual(expect.stringContaining('기존 그래프가 수정한 풀이와 맞는지'));
    expect(result.questions[0]?.checks.graph).toEqual([]);
  });

  it('retains server provenance and selected references despite client replacements', async () => {
    // Given client-edited evidence metadata different from the server generation record.
    const previous = fixture();
    const edited = { ...structuredClone(previous), references: [{ id: 'P99', title: 'changed', reason: 'changed' }], provenance: null };
    // When only trusted previous metadata is carried into the edited result.
    const result = await prepareEditedResult(previous, edited);
    // Then the true generation evidence remains unchanged.
    expect(result.provenance).toEqual(previous.provenance);
    expect(result.references).toEqual(previous.references);
  });

  it('does not accept fabricated generation evidence when no server result exists', async () => {
    // Given a manually supplied result carrying claimed server provenance.
    const edited = fixture();
    edited.productionVersion = 'hand-solution-v1';
    const step = edited.questions[0]?.steps[0];
    if (step) {
      step.graph = null;
      step.sourceConflict = '클라이언트가 제공한 원문 충돌';
    }
    // When there is no previous generation result to establish those references.
    const result = await prepareEditedResult(null, edited);
    // Then the manual result cannot manufacture a generation history.
    expect(result.provenance).toBeNull();
    expect(result.references).toEqual([]);
    expect(result.productionVersion).toBeUndefined();
    expect(result.questions[0]?.steps[0]?.sourceConflict).toBeNull();
  });

  it('retains the stored production version without duplicating its source conflict on edit', async () => {
    const previous = conflictFixture();
    const source = previous.questions[0];
    const sourceStep = source?.steps[1];
    if (!source || !sourceStep) throw new Error('Missing source conflict fixture.');
    previous.productionVersion = 'hand-solution-v1';
    sourceStep.sourceConflict = `[확인 필요] ${sourceConflict}`;
    source.uncertainties = [unrelatedWarning];
    const edited = structuredClone(previous);
    delete edited.productionVersion;

    const result = await prepareEditedResult(previous, edited);

    expect(result.productionVersion).toBe(previous.productionVersion);
    expect(result.questions[0]?.uncertainties).toEqual([unrelatedWarning]);
    expect(result.questions[0]?.steps[1]?.sourceConflict).toBe(sourceStep.sourceConflict);
  });

  it('keeps v1 math and graph edit notices out of student confirmation items', async () => {
    const previous = fixture();
    previous.productionVersion = 'hand-solution-v1';
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (!step) throw new Error('Missing graph fixture.');
    step.latex = 'y=2x';

    const result = await prepareEditedResult(previous, edited);

    expect(result.questions[0]?.steps[0]?.graph).toBeNull();
    expect(result.questions[0]?.uncertainties).toEqual([]);
    expect(result.limitations.join('\n')).toContain('이전 그래프를 숨겼습니다.');
    expect(result.limitations.join('\n')).toContain('이전 검산 기록을 비웠습니다.');
  });

  it('replaces tampered samples even when the function expression is unchanged', async () => {
    // Given client-provided numerical data that contradicts its unchanged expression.
    const previous = fixture();
    const edited = structuredClone(previous);
    const curve = edited.questions[0]?.steps[0]?.graph?.curves[0];
    if (curve) { curve.samples = [{ x: 0, y: 999 }, { x: 2, y: 999 }]; curve.segments = [curve.samples]; }
    // When the edited scene is prepared.
    const result = await prepareEditedResult(previous, edited);
    // Then server computation determines the numeric geometry.
    expect(result.questions[0]?.steps[0]?.graph?.curves[0]?.segments.at(-1)?.at(-1)).toEqual({ x: 2, y: 2 });
  }, 60_000);

  it('keeps trusted qualitative samples and math checks when changing graph presentation', async () => {
    const previous = fixture();
    const sketch = previous.questions[0]?.steps[0]?.graph;
    if (!sketch) throw new Error('Graph fixture missing');
    sketch.qualitative = true;
    const edited = structuredClone(previous);
    const graph = edited.questions[0]?.steps[0]?.graph;
    const curve = graph?.curves[0];
    if (!graph || !curve) throw new Error('Curve fixture missing');
    graph.title = '직선의 변화';
    graph.xMax = 3;
    curve.color = 'brown';
    curve.dashed = true;
    curve.samples = [{ x: 2, y: 999 }];
    curve.segments = [curve.samples];

    const result = await prepareEditedResult(previous, edited);

    expect(result.questions[0]?.steps[0]?.graph).toMatchObject({
      title: '직선의 변화', xMax: 3, curves: [{ color: 'brown', dashed: true,
        samples: sketch.curves[0]?.samples, segments: sketch.curves[0]?.segments }],
    });
    expect(result.questions[0]?.checks).toEqual({ math: ['이전 식 확인'], sequence: ['원문 순서 확인'], graph: [] });
  });

  it('rejects an inverted presentation range without replacing the trusted graph', async () => {
    const previous = fixture();
    const edited = structuredClone(previous);
    const graph = edited.questions[0]?.steps[0]?.graph;
    if (!graph) throw new Error('Graph fixture missing');
    graph.xMin = graph.xMax;
    await expect(prepareEditedResult(previous, edited)).rejects.toThrow('그래프 범위');
  });

  it('hides a graph after a formula change even when its title also changes', async () => {
    const previous = fixture();
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (!step?.graph) throw new Error('Graph fixture missing');
    step.latex = 'y=2x';
    step.graph.title = '직선의 변화';

    const result = await prepareEditedResult(previous, edited);

    expect(result.questions[0]?.steps[0]?.graph).toBeNull();
    expect(result.questions[0]?.checks).toEqual({ math: [], sequence: [], graph: [] });
  }, 60_000);

  it('keeps graphs, original branches and checks unchanged for prose-only editing', async () => {
    // Given a real source structure but a deliberately unsupported graph expression.
    // A prose-only save must not invoke the graph sampler again.
    const previous = fixture();
    const oldCurve = previous.questions[0]?.steps[0]?.graph?.curves[0];
    if (oldCurve) oldCurve.expression = 'unsupported_source_annotation';
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (step) step.explanation = '읽기 쉬운 새 설명';
    // When prose alone changes.
    const result = await prepareEditedResult(previous, edited);
    // Then the existing scene survives without accidental recomputation or sequence rewriting.
    expect(result.questions[0]?.steps[0]).toMatchObject({ originalStep: 'y=x', after: [], branch: 'parallel_condition_b', graph: previous.questions[0]?.steps[0]?.graph });
    expect(result.questions[0]?.steps[1]).toMatchObject({ originalStep: 'x=2를 대입', after: ['S01'], branch: 'main_join' });
    expect(result.questions[0]?.checks).toEqual(previous.questions[0]?.checks);
  });

  it('clears obsolete checks when problem conditions change without a new formula', async () => {
    // Given changed problem conditions beside old check statements.
    const previous = fixture();
    const edited = structuredClone(previous);
    const question = edited.questions[0];
    if (question) question.problemText = 'x=3에서 함숫값을 구하시오.';
    // When the edit is prepared.
    const result = await prepareEditedResult(previous, edited);
    // Then previous verification text cannot imply verification of the new problem.
    expect(result.questions[0]?.checks).toEqual({ math: [], sequence: [], graph: [] });
    expect(result.questions[0]?.uncertainties.length).toBeGreaterThan(0);
  });

  it('rejects broken dependency structure before saving an edited result', async () => {
    // Given a step that now points to a missing predecessor.
    const previous = fixture();
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[0];
    if (step) step.after = ['MISSING'];
    // When structural validation runs.
    const save = prepareEditedResult(previous, edited);
    // Then the incomplete source graph cannot become a saved revision.
    await expect(save).rejects.toMatchObject({ status: 400 });
  });

  it('clears only the resolved warning after a nonempty transcription correction', async () => {
    const previous = conflictFixture();
    const edited = structuredClone(previous);
    const question = edited.questions[0];
    const step = question?.steps[1];
    if (question && step) {
      step.originalStep = 'x=3을 대입';
      step.sourceConflict = '클라이언트가 보낸 충돌';
      step.after = [];
      step.branch = 'client_branch';
      question.uncertainties = [sourceWarning];
    }

    const result = await prepareEditedResult(previous, edited);

    const corrected = result.questions[0];
    expect(corrected?.steps[1]).toMatchObject({
      id: 'S02', after: ['S01'], branch: 'main_join', originalStep: 'x=3을 대입', sourceConflict: null, graph: null,
    });
    expect(corrected?.uncertainties).not.toContain(sourceWarning);
    expect(corrected?.uncertainties).toContain(unrelatedWarning);
    expect(corrected?.checks).toEqual({ math: [], sequence: [], graph: [] });
  });

  it.each(['x=2를 대입', '   ', '  x=2를 대입  '])('retains the source conflict without a substantive correction (%j)', async (originalStep) => {
    const previous = conflictFixture();
    const edited = structuredClone(previous);
    const question = edited.questions[0];
    const step = question?.steps[1];
    if (question && step) {
      step.originalStep = originalStep;
      step.sourceConflict = null;
      question.uncertainties = [];
    }

    const result = await prepareEditedResult(previous, edited);

    expect(result.questions[0]?.steps[1]?.sourceConflict).toBe(sourceConflict);
    expect(result.questions[0]?.uncertainties).toContain(sourceWarning);
  });

  it('rejects a renamed step that still needs an explicit transcription correction', async () => {
    const previous = conflictFixture();
    const edited = structuredClone(previous);
    const step = edited.questions[0]?.steps[1];
    if (step) step.id = 'S99';

    await expect(prepareEditedResult(previous, edited)).rejects.toMatchObject({ status: 400 });
  });
});
