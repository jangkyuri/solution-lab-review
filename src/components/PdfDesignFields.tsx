import { PdfDesignSchema } from '../../shared/pdf-design';
import type { PdfDesign } from '../../shared/pdf-design';
import '../styles/pdf-design-fields.css';

type Props = {
  readonly design: PdfDesign;
  readonly onChange: (design: PdfDesign) => void;
  readonly disabled?: boolean;
};

export function PdfDesignFields({ design, onChange, disabled = false }: Props) {
  function change<K extends keyof PdfDesign>(key: K, value: unknown): void {
    const parsed = PdfDesignSchema.safeParse({ ...design, [key]: value });
    if (parsed.success) onChange(parsed.data);
  }

  return <div className="pdf-design-fields">
    <label className="field">조판 양식
      <select value={design.template ?? ''} disabled={disabled} onChange={event => change('template', event.currentTarget.value || undefined)}>
        <option value="">기본 조판</option>
        <option value="baeksin-v16">백신 해설 v16</option>
      </select>
    </label>
    <label className="field">본문 글자 크기
      <select value={design.fontSize} disabled={disabled} onChange={event => change('fontSize', Number(event.currentTarget.value))}>
        <option value={10}>작게 (10pt)</option>
        <option value={11}>기본 (11pt)</option>
        <option value={12}>크게 (12pt)</option>
      </select>
    </label>
    <label className="field">쪽 여백
      <select value={design.margins} disabled={disabled} onChange={event => change('margins', event.currentTarget.value)}>
        <option value="compact">좁게</option>
        <option value="standard">기본</option>
        <option value="wide">넓게</option>
      </select>
    </label>
    <label className="field">풀이 단계 배치
      <select value={design.stepLayout} disabled={disabled} onChange={event => change('stepLayout', event.currentTarget.value)}>
        <option value="flow">단계 이어서 배치</option>
        <option value="separate">단계마다 새 쪽</option>
      </select>
    </label>
  </div>;
}
