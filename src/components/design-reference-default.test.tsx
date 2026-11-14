import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PDF_DESIGN } from '../../shared/pdf-design';
import type { DesignReference } from '../../shared/design-reference';
import { DesignReferenceForm } from './DesignReferenceForm';

const reference: DesignReference = {
  id: 'e9933e29-532b-4fd0-ac7b-15bfe779b7de', title: '테스트 원본 디자인', note: '', fileName: 'reference.pdf',
  mimeType: 'application/pdf', size: 128, fileUrl: '/api/design-references/e9933e29-532b-4fd0-ac7b-15bfe779b7de/file',
  pdfDesign: null, curveColor: null, createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z',
};

describe('reference default controls', () => {
  const callbacks = { listLoading: false, changingDefault: false, onSaved: () => {}, onSetDefault: () => {} };
  it('prompts the user to save settings before assigning an unconfigured reference', () => {
    const html = renderToStaticMarkup(<DesignReferenceForm reference={reference} {...callbacks} isDefault={false} />);
    expect(html).toContain('PDF 설정이나 그래프 강조색을 먼저 저장해 주세요.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>기본 디자인으로 설정<\/button>/u);
  });

  it('offers a clear action on the active reference', () => {
    const html = renderToStaticMarkup(<DesignReferenceForm reference={{ ...reference, pdfDesign: DEFAULT_PDF_DESIGN }}
      {...callbacks} isDefault />);
    expect(html).toContain('새 작업의 기본 디자인입니다.');
    expect(html).toContain('기본 디자인 해제');
  });
});
