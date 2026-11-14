import { useState } from 'react';
import type { FormEvent } from 'react';
import { DesignCurveColorSchema, MAX_DESIGN_REFERENCE_BYTES } from '../../shared/design-reference';
import type { DesignCurveColor, DesignReference } from '../../shared/design-reference';
import type { DesignReferenceAnalysis } from '../../shared/design-reference-analysis';
import { DEFAULT_PDF_DESIGN } from '../../shared/pdf-design';
import type { PdfDesign } from '../../shared/pdf-design';
import { errorMessage } from '../api';
import { designReferenceApi } from '../design-reference-api';
import { samePdfDesign } from '../pdf-design-equality';
import { DesignReferenceSuggestion } from './DesignReferenceSuggestion';
import { PdfDesignFields } from './PdfDesignFields';

const maxNoteLength = 10_000;

type Props = {
  readonly reference: DesignReference | null;
  readonly listLoading: boolean;
  readonly onSaved: (reference: DesignReference) => void;
  readonly isDefault: boolean;
  readonly changingDefault: boolean;
  readonly onSetDefault: (referenceId: string | null) => void;
};

export function DesignReferenceForm({ reference, listLoading, onSaved, isDefault, changingDefault, onSetDefault }: Props) {
  const [note, setNote] = useState(reference?.note ?? '');
  const [pdfDesign, setPdfDesign] = useState<PdfDesign | null>(reference?.pdfDesign ?? null);
  const [curveColor, setCurveColor] = useState<DesignCurveColor | null>(reference?.curveColor ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasSavedSettings = Boolean(reference?.pdfDesign || reference?.curveColor);
  const settingsChanged = !samePdfDesign(pdfDesign, reference?.pdfDesign) || curveColor !== reference?.curveColor;
  const clearingDefaultSettings = isDefault && !pdfDesign && !curveColor;

  function stageSuggestion(suggestion: DesignReferenceAnalysis): boolean {
    const nextNote = [note.trimEnd(), suggestion.note.trim()].filter(Boolean).join('\n\n');
    if (nextNote.length > maxNoteLength) {
      setError('기존 메모를 줄인 뒤 분석 제안을 편집칸에 넣어주세요.');
      return false;
    }
    setNote(nextNote);
    if (suggestion.pdfDesign) {
      setPdfDesign({
        ...suggestion.pdfDesign,
        ...(pdfDesign?.template ? { template: pdfDesign.template } : {}),
        ...(pdfDesign?.sourceLayout ? { sourceLayout: pdfDesign.sourceLayout } : {}),
      });
    }
    if (suggestion.curveColor) setCurveColor(suggestion.curveColor);
    setError('');
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || listLoading || changingDefault || clearingDefaultSettings) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) { setError('참고 자료의 이름을 적어주세요.'); return; }
    if (!reference) {
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) { setError('참고할 PDF나 사진을 선택해주세요.'); return; }
      if (file.size > MAX_DESIGN_REFERENCE_BYTES) { setError('20MB 이하의 파일을 선택해주세요.'); return; }
      if (pdfDesign) form.set('pdfDesign', JSON.stringify(pdfDesign));
      if (curveColor) form.set('curveColor', curveColor);
    }
    setSaving(true);
    setError('');
    try {
      const saved = reference
        ? await designReferenceApi.update(reference.id, { title, note, pdfDesign, curveColor })
        : await designReferenceApi.create(form);
      onSaved(saved);
    } catch (failure) {
      setError(await errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return <article className="design-reference-detail">
    <header className="design-reference-header">
      <h3>{reference?.title ?? '디자인 참고 자료 추가'}</h3>
      {reference && <a className="button secondary" href={reference.fileUrl} target="_blank" rel="noreferrer">원본 파일 열기</a>}
    </header>
    {reference && <section className="design-reference-default" aria-label="새 작업 기본 디자인">
      {(isDefault || !hasSavedSettings || settingsChanged) && <p className="muted">{isDefault ? '새 작업의 기본 디자인입니다.'
        : !hasSavedSettings ? 'PDF 설정이나 그래프 강조색을 먼저 저장해 주세요.'
        : '수정한 디자인 설정을 먼저 저장해 주세요.'}</p>}
      <button className="button secondary" type="button"
        disabled={listLoading || saving || changingDefault || (!isDefault && (!hasSavedSettings || settingsChanged))}
        onClick={() => onSetDefault(isDefault ? null : reference.id)}>
        {isDefault ? '기본 디자인 해제' : '기본 디자인으로 설정'}
      </button>
    </section>}
    {reference && <section className="design-reference-source" aria-label="원본 자료">
      <p className="source-meta">{reference.fileName}</p>
      {reference.mimeType.startsWith('image/') && <details>
        <summary>원본 이미지 미리보기</summary>
        <img src={reference.fileUrl} alt={`${reference.title} 참고 이미지`} loading="lazy" />
      </details>}
    </section>}
    {reference && <DesignReferenceSuggestion referenceId={reference.id} onStage={stageSuggestion} disabled={saving} />}
    <form onSubmit={event => void submit(event)}>
      <fieldset className="design-reference-fields" disabled={saving}>
        <label className="field">자료 이름
          <input name="title" defaultValue={reference?.title} required maxLength={160} />
        </label>
        {!reference && <label className="field">참고 파일 (필수)
          <input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp" />
          <span className="source-meta">PDF·PNG·JPG·WEBP · 최대 20MB</span>
        </label>}
        <label className="field">따를 요소 메모
          <textarea name="note" rows={4} value={note} maxLength={maxNoteLength} onChange={event => setNote(event.currentTarget.value)} />
        </label>
        <section className="design-reference-settings" aria-label="재사용할 디자인 설정">
          <h4>재사용할 디자인 설정</h4>
          <label className="design-reference-checkbox">
            <input type="checkbox" checked={pdfDesign !== null} onChange={event => setPdfDesign(event.currentTarget.checked ? DEFAULT_PDF_DESIGN : null)} />
            PDF 설정 함께 저장
          </label>
          {pdfDesign && <PdfDesignFields design={pdfDesign} onChange={setPdfDesign} disabled={saving} />}
          <label className="field">그래프 강조색
            <select value={curveColor ?? ''} onChange={event => {
              const parsed = DesignCurveColorSchema.safeParse(event.currentTarget.value);
              setCurveColor(parsed.success ? parsed.data : null);
            }}>
              <option value="">지정 안 함</option>
              <option value="blue">파랑</option>
              <option value="brown">갈색</option>
              <option value="gray">회색</option>
            </select>
          </label>
        </section>
        {error && <p className="notice error" role="alert">{error}</p>}
        {clearingDefaultSettings && <p className="muted">설정을 모두 빼려면 기본 디자인을 먼저 해제해 주세요.</p>}
        <div><button className="button primary" type="submit" disabled={saving || listLoading || changingDefault || clearingDefaultSettings}>
          {saving ? '저장 중…' : reference ? '변경 저장' : '참고 자료 저장'}
        </button></div>
      </fieldset>
    </form>
  </article>;
}
