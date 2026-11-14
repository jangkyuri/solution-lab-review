import { describe, expect, it } from 'vitest';
import { figureAreaIssues, figureLabelIssues } from './figure-area-review.ts';

const recipe = {
  schema_version: 'figure_recipe_v1',
  points: { L1: [-1, 2], L2: [0.8, -1], T1: [-1, 0.5], T2: [0.5, 0.5] },
  strokes: [
    { from: 'L1', to: 'T1', arrow: 'end' },
    { from: 'L2', to: 'T2', arrow: 'end' },
  ],
  visible_annotations: [
    { id: 'left', target: 'L1', text: '$\\int_{-2}^{0}(x^{3}+x^{2}-2x)\\,dx$' },
    { id: 'right', target: 'L2', text: '$-\\int_{0}^{1}(x^{3}+x^{2}-2x)\\,\\mathrm{d}x$' },
  ],
  paths: [
    { closed: true, fill: true, vertices: [[-2, 2], [-1, 1.5], [0, 0], [-1, -0.25]] },
    { closed: true, fill: true, vertices: [[0, 0], [0.5, 0.75], [1, 2], [0.5, -0.1]] },
  ],
};

describe('student figure labels', () => {
  it('accepts mathematical labels and flags Hangul inside and outside formulas', () => {
    expect(figureLabelIssues(JSON.stringify(recipe))).toEqual([]);
    const annotated = { ...recipe, visible_annotations: [
      { id: 'point', target: 'L1', text: '접점 $(1,2)$' },
      { id: 'formula', target: 'L2', text: '$\\text{넓이}=3$' },
    ] };
    expect(figureLabelIssues(JSON.stringify(annotated))).toHaveLength(2);
  });
});

describe('definite-integral arrows', () => {
  it('accepts arrowheads inside their respective shaded regions', () => {
    expect(figureAreaIssues(JSON.stringify(recipe))).toEqual([]);
  });

  it('reports the specific integral whose arrowhead lands in the other region', () => {
    const wrong = { ...recipe, points: { ...recipe.points, T2: [-1, 0.5] } };
    expect(figureAreaIssues(JSON.stringify(wrong))).toEqual([
      expect.stringContaining('\\int_{0}^{1}'),
    ]);
  });

  it('reports an arrowhead outside the fill even when its x-value is in range', () => {
    const wrong = { ...recipe, points: { ...recipe.points, T1: [-1, 1.75] } };
    expect(figureAreaIssues(JSON.stringify(wrong))).toEqual([
      expect.stringContaining('\\int_{-2}^{0}'),
    ]);
  });

  it('defers when a differently bounded shaded shape can also explain the target', () => {
    const otherFill = { closed: true, fill: true, vertices: [[-3, 1], [0, 1], [0, 2], [-3, 2]] };
    const overlapping = {
      ...recipe,
      paths: [...recipe.paths, otherFill],
      points: { ...recipe.points, T1: [-1, 1.75] },
    };
    expect(figureAreaIssues(JSON.stringify(overlapping))).toEqual([]);
  });

  it('checks coefficient-based curve fills and arrows drawn as open paths', () => {
    const curveRecipe = {
      schema_version: 'figure_recipe_v1',
      points: { L: [0, 2] },
      curves: [{ coefficients: [0, 2, -1], fill_domain: [0, 2] }],
      paths: [{ vertices: [[0, 2], [1, 2]], arrow: 'end' }],
      visible_annotations: [{ id: 'area', target: 'L', text: '$\\int_{0}^{2}x(2-x)\\,dx$' }],
    };
    expect(figureAreaIssues(JSON.stringify(curveRecipe))).toEqual([
      expect.stringContaining('\\int_{0}^{2}'),
    ]);
  });

  it('leaves transformed, symbolic and ambiguous connections to existing review', () => {
    const wrong = { ...recipe, points: { ...recipe.points, T1: [-1, 1.75], T2: [0.5, 1.75] } };
    const uncertain = {
      ...wrong,
      visible_annotations: [
        { id: 'symbolic', target: 'L1', text: '$\\int_{a}^{0}f(x)\\,dx$' },
        { id: 'shifted', target: 'L2', text: '$\\int_{2}^{3}f(x)\\,dx$' },
        { id: 'ambiguous', target: 'L2', text: '$\\int_{0}^{1}f(x)\\,dx$' },
      ],
      strokes: [...wrong.strokes, { from: 'L2', to: 'T1', arrow: 'end' }],
    };
    expect(figureAreaIssues(JSON.stringify(uncertain))).toEqual([]);
  });

  it('asks for a definite integral when a numeric area label points into a shade', () => {
    const numericLabels = {
      ...recipe,
      visible_annotations: [
        { id: 'left', target: 'L1', text: '넓이 $\\frac{8}{3}$' },
        { id: 'right', target: 'L2', text: '$F(1)-F(0)$' },
        { id: 'point', target: 'T2', text: '$1$' },
      ],
    };
    expect(figureAreaIssues(JSON.stringify(numericLabels), '\\int_{-2}^{0}f(x)\\,dx')).toEqual([
      expect.stringContaining('넓이 $\\frac{8}{3}$'),
    ]);
    expect(figureAreaIssues(JSON.stringify(numericLabels))).toEqual([]);
  });
});
