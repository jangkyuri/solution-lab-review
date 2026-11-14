import { describe, expect, it } from 'vitest';
import { bookletFigure, bookletNativeGraphWidth } from './pdf-booklet-graphs.ts';
import { StepBookletSchema } from '../shared/contracts.ts';

const links = [{ anchors: [{ x: 1, y: 2 }], latex: 'f(1)=2', note: '극솟값', color: 'blue' }] as const;

describe('native graph sizes in finished references', () => {
  it.each([
    { figure: 'side', compact: true, expectedFigure: 'side', width: 190 },
    { figure: 'small', compact: true, expectedFigure: 'small', width: 150 },
    { figure: 'wide', compact: true, expectedFigure: 'wide', width: 460 },
    { figure: 'side', compact: false, expectedFigure: 'wide', width: 460 },
  ] as const)('uses $width native bp for a $figure linked graph (finished=$compact)', ({ figure, compact, expectedFigure, width }) => {
    // Given: an explicit figure choice and a short, valid point-to-equation link.
    const booklet = StepBookletSchema.parse({ figure, graphLinks: links });
    // When: staging and student layout resolve the same graph profile.
    const renderedFigure = bookletFigure(booklet, compact);
    const nativeWidth = bookletNativeGraphWidth(booklet, compact);
    // Then: the native font-preserving graph and its page column agree.
    expect(renderedFigure).toBe(expectedFigure);
    expect(nativeWidth).toBe(width);
  });
});
