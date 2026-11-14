import { useEffect, useState } from 'react';
import type { DesignReference } from '../../shared/design-reference';
import { designReferenceApi } from '../design-reference-api';

type Props = { readonly disabled?: boolean; readonly onApply: (reference: DesignReference) => void };

export function DesignReferencePicker({ disabled = false, onApply }: Props) {
  const [references, setReferences] = useState<readonly DesignReference[] | null>(null);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [appliedId, setAppliedId] = useState('');
  const selected = references?.find(reference => reference.id === selectedId);

  useEffect(() => {
    let active = true;
    void designReferenceApi.list().then(items => {
      if (active) setReferences(items);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => { active = false; };
  }, []);

  return <section className="editor-question" aria-labelledby="design-reference-picker-title">
    <h3 id="design-reference-picker-title">저장한 디자인 적용</h3>
    {error ? <p className="notice error" role="alert">저장한 디자인을 불러오지 못했습니다.</p>
      : references === null ? <p className="muted" role="status">저장한 디자인을 불러오는 중입니다.</p>
      : references.length === 0 ? <p className="muted">저장한 디자인이 없습니다.</p>
      : <>
        <label className="field">저장한 디자인<select value={selectedId} onChange={event => { setSelectedId(event.currentTarget.value); setAppliedId(''); }}>
          <option value="">디자인 선택</option>
          {references.map(reference => <option key={reference.id} value={reference.id}>{reference.title}</option>)}
        </select></label>
        {selected && <>
          {selected.note && <p className="plain-prose">{selected.note}</p>}
          <a href={selected.fileUrl} target="_blank" rel="noreferrer">디자인 원본 보기</a>
          {selected.pdfDesign || selected.curveColor ? <button className="button secondary" type="button" disabled={disabled} onClick={() => { onApply(selected); setAppliedId(selected.id); }}>저장된 설정 불러오기</button>
            : <p className="muted">저장된 PDF 양식과 그래프 색이 없습니다.</p>}
          {appliedId === selected.id && <p className="muted" role="status">디자인 설정을 불러왔습니다.</p>}
        </>}
      </>}
  </section>;
}

