import type { PdfDesign } from '../shared/pdf-design';

export function samePdfDesign(left: PdfDesign | null | undefined, right: PdfDesign | null | undefined): boolean {
  return left?.fontSize === right?.fontSize
    && left?.margins === right?.margins
    && left?.stepLayout === right?.stepLayout
    && left?.template === right?.template
    && left?.sourceLayout === right?.sourceLayout;
}
