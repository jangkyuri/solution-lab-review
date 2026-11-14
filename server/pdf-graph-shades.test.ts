import { describe, expect, it } from 'vitest';
import { clipGraphLine, graphPanel, mapGraphPoint } from './pdf-graph-geometry.ts';
import { findPolygonLabelBox } from './pdf-graph-shades.ts';
import { GraphLabelPlacer, graphInlineLabel } from './pdf-graph-labels.ts';

const rectangle = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
const region = [{ x: -2, y: 10 }, { x: -1.5, y: 11.875 }, { x: -1, y: 12 }, { x: -.5, y: 11.125 },
  { x: 0, y: 10 }, { x: .5, y: 9.375 }, { x: 1, y: 10 }, { x: 1.5, y: 12.625 }, { x: 2, y: 18 },
  { x: 1.5, y: 11.75 }, { x: 1, y: 7 }, { x: .5, y: 3.75 }, { x: 0, y: 2 }, { x: -.5, y: 1.75 },
  { x: -1, y: 3 }, { x: -1.5, y: 5.75 }, { x: -2, y: 10 }];

describe('labels inside shaded graph regions', () => {
  it('keeps the entire label and its clearance inside a rectangular region', () => {
    // Given: a finite area large enough for a full-size label.
    // When: choosing a label rectangle.
    const box = findPolygonLabelBox(rectangle, 40, 14);
    // Then: every edge keeps the required boundary clearance.
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.right - box.left).toBe(40);
    expect(box.top - box.bottom).toBe(14);
    expect(Math.min(box.left, box.bottom, 100 - box.right, 60 - box.top)).toBeGreaterThanOrEqual(3);
  });

  it('does not span the opening of a concave region even when its outer bounds fit', () => {
    // Given: a U-shaped region whose arms and base cannot fit the label.
    const concave = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 75, y: 60 },
      { x: 75, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 60 }, { x: 0, y: 60 }];
    // When: placing a rectangle wider than the arms and taller than the base.
    const box = findPolygonLabelBox(concave, 55, 18);
    // Then: the label is omitted rather than crossing a boundary.
    expect(box).toBeNull();
  });

  it('does not shrink a label to fit a narrow region', () => {
    // Given: an area narrower than the requested text.
    const narrow = rectangle.map((point) => ({ x: point.x / 10, y: point.y }));
    // When: requesting the original text dimensions.
    const box = findPolygonLabelBox(narrow, 40, 14);
    // Then: no unsafe placement is returned.
    expect(box).toBeNull();
  });

  it('fits an area label in a sufficiently wide cubic and quadratic panel without touching either boundary', () => {
    // Given: the sampled area from the actual application export in a wider panel.
    const polygon = region.map((point) => mapGraphPoint(point, { xMin: -2.4, xMax: 2.4, yMin: 0, yMax: 25 }, graphPanel(300)));
    const label = graphInlineLabel('구하는 넓이');
    // When: accounting for the native node white padding.
    const box = findPolygonLabelBox(polygon, label.width + 2, (label.height ?? 14) + 2);
    // Then: the entire padded node clears every polygon edge by at least 3bp.
    expect(box).not.toBeNull();
    if (!box) return;
    const expanded = { xMin: box.left - 2.99, xMax: box.right + 2.99, yMin: box.bottom - 2.99, yMax: box.top + 2.99 };
    expect(polygon.every((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return next && clipGraphLine(point, next, expanded) === null;
    })).toBe(true);
  });

  it('omits the full-size label when the actual compact region has no interior room', () => {
    // Given: the actual compact panel leaves too little space between its two curves.
    const polygon = region.map((point) => mapGraphPoint(point, { xMin: -2.4, xMax: 2.4, yMin: 0, yMax: 25 }, graphPanel(190)));
    const label = graphInlineLabel('구하는 넓이');
    // When: the label uses its original font, dimensions, and boundary clearance.
    const box = findPolygonLabelBox(polygon, label.width + 2, (label.height ?? 14) + 2);
    // Then: an unsafe label is omitted instead of hiding the curve.
    expect(box).toBeNull();
  });

  it('reserves the interior label rectangle against later annotations', () => {
    // Given: an occupied interior label with only one nearby placement that would overlap.
    const placer = new GraphLabelPlacer(graphPanel(190));
    // When: placing the shade label followed by another label.
    const inside = placer.placeInside(rectangle, { tex: 'area', width: 40, height: 14 });
    const positioned = inside?.match(/at \(([-\d.]+),([-\d.]+)\)/u);
    if (!positioned?.[1] || !positioned[2]) throw new Error('Missing interior label position');
    const later = placer.place({ x: Number(positioned[1]) - 5, y: Number(positioned[2]) - 6 }, { tex: 'curve', width: 40, height: 14 });
    // Then: both are positioned by the common occupancy-aware placement system.
    expect(inside).not.toBeNull();
    expect(inside).toContain('fontsize{10.2bp}{14bp}');
    expect(later).not.toContain('at (' + positioned[1] + ',' + positioned[2] + ')');
  });
});
