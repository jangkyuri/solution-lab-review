import { describe, expect, it } from 'vitest';
import { findGraphLabelPosition } from './graph-label-layout';
import type { ScreenSegment } from './graph-label-layout';

describe('graph label placement', () => {
  const viewport = { width: 220, height: 140 };
  const text = { x: 46, y: 50, width: 95, height: 13 };
  const axis: ScreenSegment = [{ x: 0, y: 58 }, { x: 220, y: 58 }];

  it('moves a label off an axis that crosses its width', () => {
    const position = findGraphLabelPosition(text, viewport, [axis], []);
    expect(position).toEqual({ ...text, y: 34 });
  });

  it('avoids another label as well as the plotted axis', () => {
    const occupied = [{ ...text, y: 34 }];
    const position = findGraphLabelPosition(text, viewport, [axis], occupied);
    expect(position).toEqual({ ...text, y: 66 });
  });

  it('leaves the graph when the label cannot fit inside', () => {
    expect(findGraphLabelPosition(text, { width: 90, height: 40 }, [axis], [])).toBeUndefined();
  });
});
