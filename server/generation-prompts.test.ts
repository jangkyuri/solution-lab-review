import { describe, expect, it } from 'vitest';
import { generationInstructions } from './generation-prompts.ts';

describe('figure recipe in finished solutions', () => {
  it.each(['solve', 'supplement'] as const)('gives %s mode a function and its matching area in the same curve', (mode) => {
    const prompt = generationInstructions({ mode });
    const example = prompt.split('\n').find((line) => line.includes('{"schema_version":"figure_recipe_v1"')) ?? '';
    const recipe: unknown = JSON.parse(example.slice(example.indexOf('{'), example.lastIndexOf('}') + 1));

    expect(recipe).toMatchObject({
      schema_version: 'figure_recipe_v1',
      curves: [{ id: 'curve_1', expression: 'x*(4-x)', plot_domain: [-0.2, 4.2], fill_domain: [0, 4] }],
      point_markers: { area_label_anchor: 'none', area_inside: 'none' },
      strokes: [{ id: 'area_arrow', from: 'area_label_anchor', to: 'area_inside', line_style: 'solid', arrow: 'end' }],
      visible_annotations: expect.arrayContaining([
        { id: 'label_curve', text: '$y=x(4-x)$', target: 'curve_1', preferred_direction: 'N' },
        { id: 'label_area', text: '$\\int_{0}^{4}x(4-x)\\,dx$', target: 'area_label_anchor', preferred_direction: 'E' },
      ]),
    });
    expect(recipe).not.toHaveProperty('paths');
  });
});
