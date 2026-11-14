import { useEffect, useRef, useState } from 'react';
import type { SolutionResult } from '../shared/contracts';
import type { PdfDesign } from '../shared/pdf-design';
import { api, errorMessage } from './api';
import type { PdfPreviewPages } from './api';
import { samePdfDesign } from './pdf-design-equality';

type Preview = {
  readonly url: string;
  readonly pageCount: number;
  readonly pages: PdfPreviewPages;
  readonly result: SolutionResult;
  readonly design: PdfDesign;
};

export function usePdfPreview(jobId: string) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => () => {
    active.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  async function render(result: SolutionResult, design: PdfDesign, draft: SolutionResult | null): Promise<void> {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    try {
      const rendered = await api.pdfPreview(jobId, draft, design, controller.signal);
      if (controller.signal.aborted) return;
      const bytes = Uint8Array.from(atob(rendered.pdfBase64), character => character.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setPreview({ url, result, design, pages: rendered.pages, pageCount: rendered.pageCount });
    } catch (failure) {
      if (controller.signal.aborted) return;
      const message = await errorMessage(failure);
      if (!controller.signal.aborted) setError(message);
    } finally {
      if (active.current === controller && !controller.signal.aborted) setPending(false);
    }
  }

  return {
    url: preview?.url ?? null, pages: preview?.pages ?? [], pageCount: preview?.pageCount ?? 0, pending, error, render,
    isCurrent: (result: SolutionResult | null, design: PdfDesign) => preview?.result === result
      && samePdfDesign(preview.design, design),
  };
}
