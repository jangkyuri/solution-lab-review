import { describe, expect, it } from 'vitest';
import { DEFAULT_PDF_DESIGN, LEGACY_PDF_DESIGN, type PdfDesign } from '../shared/pdf-design';
import { samePdfDesign } from './pdf-design-equality';

describe('PDF design equality', () => {
  it('recognizes an unchanged copy of the saved settings', () => {
    const saved = DEFAULT_PDF_DESIGN;

    const unchanged = samePdfDesign(saved, { ...saved });

    expect(unchanged).toBe(true);
  });

  it.each([
    { ...DEFAULT_PDF_DESIGN, fontSize: 12 },
    { ...DEFAULT_PDF_DESIGN, margins: 'wide' },
    { ...DEFAULT_PDF_DESIGN, stepLayout: 'separate' },
    { ...LEGACY_PDF_DESIGN, sourceLayout: 'stacked-reference' },
    { ...LEGACY_PDF_DESIGN, template: 'baeksin-v16' },
  ] satisfies readonly PdfDesign[])('detects changed settings: %j', changed => {
    const saved = DEFAULT_PDF_DESIGN;

    const unchanged = samePdfDesign(saved, changed);

    expect(unchanged).toBe(false);
  });

  it('recognizes null and undefined as absent settings', () => {
    const saved = null;

    const unchanged = samePdfDesign(saved, undefined);

    expect(unchanged).toBe(true);
  });

  it('detects settings added to an unconfigured reference', () => {
    const saved = null;

    const unchanged = samePdfDesign(saved, DEFAULT_PDF_DESIGN);

    expect(unchanged).toBe(false);
  });
});
