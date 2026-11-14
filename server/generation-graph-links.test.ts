import { describe, expect, it } from 'vitest';
import { GraphLinkSchema, GraphSchema, StepBookletSchema } from '../shared/contracts.ts';
import { finalizeGeneration } from './generation-finalize.ts';
import { generatedFixture, readingFixture, libraryFixture, exampleFixture, jobFixture } from './generation-fixtures.ts';
import { GeneratedResultSchema } from './generation-schemas.ts';
import { generationQualityIssues } from './generation-quality.ts';

const link = { anchors: [{ x: 1, y: 1 }], latex: "f'(1)=2", note: '이 점에서의 접선 기울기이다.', color: 'blue' } as const;

function fixture() {
  const generated = generatedFixture();
  const step = generated.questions[0]?.steps[0];
  if (!step) throw new Error('Missing step fixture.');
  step.graph = GraphSchema.parse({ title: '접선 기울기', xMin: 0, xMax: 2, yMin: 0, yMax: 4, xLabel: 'x', yLabel: 'y', curves: [], points: [{ x: 1, y: 1, label: '', open: false }], verticals: [], explanation: '' });
  step.booklet = { group: null, equationRole: null, keyPhrases: null, equationNote: null, takeaway: null, referenceTip: null, termNotes: null, graphLinks: [{ ...GraphLinkSchema.parse(link), anchorLabels: null }], figure: null, zoom: null, zoomNote: null, table: null };
  return { generated, step };
}

describe('semantic graph point-to-equation links', () => {
  it('keeps old booklets valid while bounding the new public link structure', () => {
    expect(StepBookletSchema.parse({})).toEqual({});
    expect(GraphLinkSchema.parse(link)).toEqual(link);
    expect(StepBookletSchema.safeParse({ graphLinks: [link, link, link, link] }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...link, anchors: [] }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...link, anchors: Array.from({ length: 4 }, () => ({ x: 1, y: 1 })) }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...link, latex: '' }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...link, latex: 'x'.repeat(241) }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...link, note: '가'.repeat(101) }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...link, anchors: [{ x: Number.POSITIVE_INFINITY, y: 1 }] }).success).toBe(false);
  });

  it('requires a nullable model field and preserves valid links through finalization without changing source order', () => {
    const { generated } = fixture();
    const model = GeneratedResultSchema.parse(generated);
    const question = finalizeGeneration(model, readingFixture, 'supplement', libraryFixture, [exampleFixture]).questions[0];
    expect(question?.steps[0]?.booklet?.graphLinks).toEqual([link]);
    expect(question?.steps.map(({ id, after, originalStep }) => ({ id, after, originalStep }))).toEqual([{ id: 'S01', after: [], originalStep: 'f(x+h)-f(x)' }]);
    const raw: unknown = JSON.parse(JSON.stringify(generated).replace(/"graphLinks":\[[\s\S]*?\],"figure"/u, '"figure"'));
    expect(GeneratedResultSchema.safeParse(raw).success).toBe(false);
  });

  it('keeps point labels at the public boundary and bounds their count and size', () => {
    // Given an existing link and one local label for its one anchor.
    const labeled = { ...link, anchorLabels: ['접점도 1개'] };
    // When the public contract parses the new optional field.
    const parsed = GraphLinkSchema.parse(labeled);
    // Then it preserves the labels and rejects unrenderable field bounds.
    expect(parsed).toEqual(labeled);
    expect(GraphLinkSchema.safeParse({ ...labeled, anchorLabels: [] }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...labeled, anchorLabels: ['가'.repeat(81)] }).success).toBe(false);
    expect(GraphLinkSchema.safeParse({ ...labeled, anchorLabels: ['1', '2', '3', '4'] }).success).toBe(false);
  });

  it('requires nullable point labels in the model schema and preserves labeled output through finalization', () => {
    // Given a model link with a local inline-math label.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.booklet) throw new Error('Missing link fixture.');
    const labeled = { ...current, anchorLabels: ['  \\(f(1)=1\\)  '] };
    step.booklet.graphLinks = [labeled];
    // When a structured model result is parsed and finalized.
    const parsed = GeneratedResultSchema.parse(generated);
    const result = finalizeGeneration(parsed, readingFixture, 'supplement', libraryFixture, [exampleFixture]);
    // Then the local label survives with whitespace trimmed and source order unchanged.
    expect(result.questions[0]?.steps[0]?.booklet?.graphLinks?.[0]).toMatchObject({ anchorLabels: ['\\(f(1)=1\\)'] });
    const raw: unknown = JSON.parse(JSON.stringify(generated).replace(/,"anchorLabels":\[[^\]]*\]/gu, ''));
    expect(GeneratedResultSchema.safeParse(raw).success).toBe(false);
  });

  it.each([{ anchorLabels: [] }, { anchorLabels: ['  '] }])('normalizes empty model point-label input to the existing unlabeled behavior (%j)', ({ anchorLabels }) => {
    // Given a model link whose optional display labels have no content.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.booklet) throw new Error('Missing link fixture.');
    step.booklet.graphLinks = [{ ...current, anchorLabels }];
    // When the structured result is finalized.
    const result = finalizeGeneration(GeneratedResultSchema.parse(generated), readingFixture, 'supplement', libraryFixture, [exampleFixture]);
    // Then the existing safe equation and anchors remain without an empty override.
    expect(result.questions[0]?.steps[0]?.booklet?.graphLinks).toEqual([link]);
  });

  it('rejects labels whose positional mapping does not match the anchors', () => {
    // Given a valid graph link with two labels for its one anchor.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.booklet) throw new Error('Missing link fixture.');
    const labeled = { ...current, anchorLabels: ['첫 점', '다른 점'] };
    step.booklet.graphLinks = [labeled];
    // When quality checks inspect the actual label-to-point mapping.
    const issues = generationQualityIssues({ mode: 'supplement' }, readingFixture, generated);
    // Then the mismatched mapping is rejected without changing either label.
    expect(issues.some((issue) => issue.includes('라벨 수') && issue.includes('시작점'))).toBe(true);
    expect(labeled.anchorLabels).toEqual(['첫 점', '다른 점']);
  });

  it('rejects a partially blank label list without shifting the remaining point labels', () => {
    // Given two actual graph points and a positional label missing only its second item.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.booklet || !step.graph) throw new Error('Missing link fixture.');
    step.graph.points.push({ x: 1.5, y: 2, label: '', open: false });
    const labeled = { ...current, anchors: [{ x: 1, y: 1 }, { x: 1.5, y: 2 }], anchorLabels: ['1개', '  '] };
    step.booklet.graphLinks = [labeled];
    // When the positional labels are validated before finalization.
    const issues = generationQualityIssues({ mode: 'supplement' }, readingFixture, generated);
    // Then the missing local meaning is rejected and later labels are never shifted to another point.
    expect(issues.some((issue) => issue.includes('라벨에 빈 항목'))).toBe(true);
    expect(labeled.anchorLabels).toEqual(['1개', '  ']);
  });

  it('inspects local labels for unsafe inline math, meta narration, and source-absent functions', () => {
    // Given local point labels displayed beside an otherwise valid graph.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.booklet) throw new Error('Missing link fixture.');
    const labeled = { ...current, anchorLabels: ['\\(\\unknown{x}\\)'] };
    step.booklet.graphLinks = [labeled];
    // When quality checks inspect each changed local label.
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('인라인 수식'))).toBe(true);
    labeled.anchorLabels = ['사진의 점이다.'];
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('메모·제작 서술'))).toBe(true);
    labeled.anchorLabels = ['\\(h(1)=1\\)'];
    // Then unsafe commands and source-absent claims receive the same checks as other student text.
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('원문에 없는 함수 h'))).toBe(true);
  });

  it('accepts only anchors from the current step graph and within its visible bounds', () => {
    const { generated, step } = fixture();
    expect(generationQualityIssues({ ...jobFixture, mode: 'supplement' }, readingFixture, generated)).toEqual([]);
    if (!step.booklet?.graphLinks?.[0] || !step.graph) throw new Error('Missing link fixture.');
    step.booklet.graphLinks[0].anchors = [{ x: 1 + 1e-9, y: 1 }];
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)).toEqual([]);
    step.booklet.graphLinks[0].anchors = [{ x: 1.1, y: 1 }];
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('현재 단계 그래프의 점'))).toBe(true);
    step.booklet.graphLinks[0].anchors = [{ x: 1, y: 1 }];
    step.graph.xMax = 0.5;
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('그래프 범위'))).toBe(true);
    step.graph = null;
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('현재 단계 그래프가 필요'))).toBe(true);
  });

  it('inspects link equations and notes without repairing unsafe or source-absent content', () => {
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current) throw new Error('Missing link fixture.');
    current.latex = '\\input{secret}';
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('그래프 연결 수식'))).toBe(true);
    expect(current.latex).toBe('\\input{secret}');
    current.latex = 'h(x)=x^2';
    current.note = '사진의 식이다.';
    const issues = generationQualityIssues({ mode: 'supplement' }, readingFixture, generated);
    expect(issues.some((issue) => issue.includes('원문에 없는 함수 h'))).toBe(true);
    expect(issues.some((issue) => issue.includes('메모·제작 서술'))).toBe(true);
    current.latex = link.latex;
    current.note = '\\(\\unknown{x}\\)';
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated).some((issue) => issue.includes('인라인 수식'))).toBe(true);
  });

  it('does not borrow an anchor from another step graph', () => {
    const { generated, step } = fixture();
    const question = generated.questions[0];
    if (!question || !step.graph || !step.booklet) throw new Error('Missing graph fixture.');
    question.steps.push({ ...step, id: 'S02', after: ['S01'],
      graph: { ...step.graph, points: [{ x: 0, y: 0, label: '', open: false }] },
      booklet: { ...step.booklet, graphLinks: [{ ...GraphLinkSchema.parse(link), anchorLabels: null }] },
    });
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)
      .some((issue) => issue.includes('S02') && issue.includes('현재 단계 그래프의 점'))).toBe(true);
  });

  it.each([
    [{ x: 1, y: 1 }, { x: 1, y: 1 }],
    [{ x: 1, y: 1 }, { x: 1 + 5e-9, y: 1 }],
    [{ x: 1 - 9e-9, y: 1 }, { x: 1 + 9e-9, y: 1 }],
  ])('rejects duplicate anchors after matching them to the actual graph points (%j)', (...anchors) => {
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current) throw new Error('Missing link fixture.');
    current.anchors = anchors;
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)
      .some((issue) => issue.includes('같은 점을 두 번'))).toBe(true);
    expect(current.anchors).toEqual(anchors);
  });

  it('keeps separate graph points outside the matching tolerance valid', () => {
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.graph) throw new Error('Missing link fixture.');
    step.graph.points.push({ x: 1 + 2e-8, y: 1, label: '', open: false });
    current.anchors = [{ x: 1, y: 1 }, { x: 1 + 2e-8, y: 1 }];
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)).toEqual([]);
  });

  it.each([{ label: '가'.repeat(19), within: '가'.repeat(18) }, { label: 'x'.repeat(34), within: 'x'.repeat(33) }])('rejects local labels that exceed the actual display width (%j)', ({ label, within }) => {
    // Given a label within the public character limit but too wide for a graph annotation.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current) throw new Error('Missing link fixture.');
    current.anchorLabels = [label];
    expect(GraphLinkSchema.safeParse({ ...link, anchorLabels: [label] }).success).toBe(true);
    // When generation quality is checked before PDF output.
    const issues = generationQualityIssues({ mode: 'supplement' }, readingFixture, generated);
    // Then the same renderer width limit rejects the label without shortening it silently.
    expect(issues).toHaveLength(1);
    expect(current.anchorLabels).toEqual([label]);
    current.anchorLabels = [within];
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)).toEqual([]);
  });

  it.each([
    { zoom: null, anchorLabels: null, expectedIssues: 0 },
    { zoom: { xMin: 0, xMax: 1.5, yMin: 0, yMax: 2 }, anchorLabels: null, expectedIssues: 1 },
    { zoom: { xMin: 0, xMax: 1.5, yMin: 0, yMax: 2 }, anchorLabels: ['1개'], expectedIssues: 0 },
  ])('checks local equations against the narrow zoom graph only when they sit beside the point (%j)', ({ zoom, anchorLabels, expectedIssues }) => {
    // Given an equation that fits a wide graph but cannot fit beside a point in a zoom main panel.
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current || !step.booklet) throw new Error('Missing link fixture.');
    current.latex = 'k+k+k+k+k+k+k+k+k+k+k+k=12k';
    current.note = '';
    current.anchorLabels = anchorLabels;
    step.booklet.zoom = zoom;
    // When generation checks the actual point-label placement chosen for the output width.
    const issues = generationQualityIssues({ mode: 'supplement' }, readingFixture, generated);
    // Then only the unlabelled narrow local equation needs correction; the original equation remains intact.
    expect(issues).toHaveLength(expectedIssues);
    expect(current.latex).toBe('k+k+k+k+k+k+k+k+k+k+k+k=12k');
  });

  it('rejects a safe but overwide link equation without shortening the stored formula', () => {
    const { generated, step } = fixture();
    const current = step.booklet?.graphLinks?.[0];
    if (!current) throw new Error('Missing link fixture.');
    const longEquation = `${Array.from({ length: 18 }, () => '1').join('+')}=18`;
    current.latex = longEquation;
    expect(GraphLinkSchema.safeParse({ ...link, latex: longEquation }).success).toBe(true);
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)
      .some((issue) => issue.includes('연결 수식이 표시 공간보다 깁니다'))).toBe(true);
    expect(current.latex).toBe(longEquation);
    current.latex = `${Array.from({ length: 15 }, () => '1').join('+')}=15`;
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)).toEqual([]);
    current.latex = '\\frac{1}{2}=0.5';
    expect(generationQualityIssues({ mode: 'supplement' }, readingFixture, generated)).toEqual([]);
  });
});
