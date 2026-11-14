import { useEffect, useRef, useState } from 'react';
import type { DesignReferenceAnalysis } from '../../shared/design-reference-analysis';
import { errorMessage } from '../api';
import { designReferenceApi } from '../design-reference-api';

type Props = {
  readonly referenceId: string;
  readonly onStage: (suggestion: DesignReferenceAnalysis) => boolean;
  readonly disabled: boolean;
};

const marginLabels = { compact: '좁게', standard: '기본', wide: '넓게' } as const;
const layoutLabels = { flow: '단계 이어서 배치', separate: '단계마다 새 쪽' } as const;
const colorLabels = { blue: '파랑', brown: '갈색', gray: '회색' } as const;

export function DesignReferenceSuggestion({ referenceId, onStage, disabled }: Props) {
  const request = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [suggestion, setSuggestion] = useState<DesignReferenceAnalysis | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => request.current?.abort(), []);

  async function analyze(): Promise<void> {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setSuggestion(null);
    setNotice('');
    setError('');
    try {
      const result = await designReferenceApi.analyze(referenceId, controller.signal);
      if (!controller.signal.aborted) setSuggestion(result);
    } catch (failure) {
      const message = await errorMessage(failure);
      if (!controller.signal.aborted) setError(message);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return <section className="design-reference-analysis" aria-label="참고 자료 분석">
    <div className="design-reference-analysis-header">
      <p className="muted" id="analysis-sharing-note">분석 시 원본 파일을 OpenAI로 전송합니다.</p>
      <button type="button" className="button secondary" aria-describedby="analysis-sharing-note" disabled={running || disabled} onClick={() => void analyze()}>
        {running ? '디자인 분석 중…' : 'OpenAI로 디자인 분석'}
      </button>
    </div>
    <span className="sr-only" role="status">{running ? '디자인 분석 중…' : ''}</span>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {suggestion && <div className="design-reference-suggestion">
      <h4>디자인 제안</h4>
      <p className="design-reference-note">{suggestion.note}</p>
      {suggestion.pdfDesign && <p className="source-meta">본문 {suggestion.pdfDesign.fontSize}pt · 여백 {marginLabels[suggestion.pdfDesign.margins]} · {layoutLabels[suggestion.pdfDesign.stepLayout]}</p>}
      {suggestion.curveColor && <p className="source-meta">그래프 강조색 · {colorLabels[suggestion.curveColor]}</p>}
      <button type="button" className="button secondary" disabled={disabled} onClick={() => {
        if (onStage(suggestion)) {
          setSuggestion(null);
          setNotice('제안을 편집칸에 넣었습니다.');
        }
      }}>편집칸에 넣기</button>
    </div>}
  </section>;
}
