import { useEffect, useState } from 'react';
import { errorMessage } from '../api';
import { designReferenceApi } from '../design-reference-api';
import type { DesignReference } from '../../shared/design-reference';
import { DesignReferenceForm } from './DesignReferenceForm';
import '../styles/design-library.css';

export function DesignLibraryView({ onDefaultChanged }: { readonly onDefaultChanged?: () => void }) {
  const [references, setReferences] = useState<readonly DesignReference[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultReferenceId, setDefaultReferenceId] = useState<string | null>(null);
  const [changingDefault, setChangingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [reload, setReload] = useState(0);
  const selected = references.find(reference => reference.id === selectedId) ?? null;
  const defaultReference = references.find(reference => reference.id === defaultReferenceId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void designReferenceApi.library(controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setReferences(next.references);
      setDefaultReferenceId(next.defaultReferenceId);
    }).catch(async (failure: unknown) => {
      const message = await errorMessage(failure);
      if (!controller.signal.aborted) setError(message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [reload]);

  function select(id: string | null): void {
    setSelectedId(id);
    setSavedNotice('');
    setDefaultError('');
  }

  function save(reference: DesignReference, previousId: string | null): void {
    setReferences(current => [reference, ...current.filter(item => item.id !== reference.id)]);
    setSelectedId(current => current === previousId ? reference.id : current);
    setSavedNotice('디자인 참고 자료를 저장했습니다.');
    if (reference.id === defaultReferenceId) onDefaultChanged?.();
  }

  async function changeDefault(referenceId: string | null): Promise<void> {
    setChangingDefault(true);
    setDefaultError('');
    setSavedNotice('');
    try {
      const next = await designReferenceApi.setDefault(referenceId);
      setDefaultReferenceId(next.defaultReferenceId);
      setSavedNotice(next.defaultReferenceId ? '새 작업의 기본 디자인으로 설정했습니다.' : '기본 디자인을 해제했습니다.');
      onDefaultChanged?.();
    } catch (failure) {
      setDefaultError(await errorMessage(failure));
    } finally {
      setChangingDefault(false);
    }
  }

  return <section className="page-content design-library">
    {error && <div className="notice error" role="alert">
      <p>{error}</p>
      <button type="button" className="text-button" onClick={() => setReload(attempt => attempt + 1)}>다시 불러오기</button>
    </div>}
    {!loading && !error && <p className="design-default-status">
      새 작업 기본 디자인 · <strong>{defaultReference?.title ?? '기본 조판'}</strong>
    </p>}
    {defaultError && <p className="notice error" role="alert">{defaultError}</p>}
    {savedNotice && <p className="notice success" role="status">{savedNotice}</p>}
    <div className="design-library-layout">
      <nav className="record-list design-reference-list" aria-label="저장한 디자인 참고 자료">
        <button type="button" className={selected ? undefined : 'active'} aria-current={selected ? undefined : 'true'} onClick={() => select(null)}>
          <strong>새 자료 추가</strong>
        </button>
        {loading && <p className="empty-note" role="status">참고 자료를 불러오고 있습니다.</p>}
        {references.map(reference => <button key={reference.id} type="button"
          className={selected?.id === reference.id ? 'active' : undefined}
          aria-current={selected?.id === reference.id ? 'true' : undefined}
          onClick={() => select(reference.id)}>
          <strong>{reference.title}</strong>
          <small>{reference.mimeType === 'application/pdf' ? 'PDF' : '이미지'} · {reference.fileName}</small>
          {reference.id === defaultReferenceId && <span className="badge neutral">새 작업 기본값</span>}
        </button>)}
        {!loading && !error && references.length === 0 && <p className="empty-note">저장한 자료가 없습니다.</p>}
      </nav>
      <DesignReferenceForm key={selected ? `${selected.id}:${selected.updatedAt}` : 'new'} reference={selected}
        listLoading={loading} onSaved={reference => save(reference, selected?.id ?? null)}
        isDefault={selected?.id === defaultReferenceId} changingDefault={changingDefault}
        onSetDefault={referenceId => void changeDefault(referenceId)} />
    </div>
  </section>;
}
