import type { PdfDesign } from '../../shared/pdf-design';
import { PdfDesignFields } from './PdfDesignFields';

type Props = {
  readonly design: PdfDesign;
  readonly onChange: (design: PdfDesign) => void;
  readonly onPreview: () => void;
  readonly busy: boolean;
};

export function PdfDesignPanel({ design, onChange, onPreview, busy }: Props) {
  return <section className="editor-question" aria-labelledby="pdf-design-title">
    <h3 id="pdf-design-title">PDF 양식</h3>
    <PdfDesignFields design={design} onChange={onChange} />
    <button className="button secondary" type="button" disabled={busy} onClick={onPreview}>
      {busy ? 'PDF 준비 중…' : 'PDF 미리보기 갱신'}
    </button>
  </section>;
}
