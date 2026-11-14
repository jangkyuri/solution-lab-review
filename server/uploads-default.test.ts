import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { DesignReferenceSchema } from '../shared/design-reference.ts';
import { PdfDesignSchema } from '../shared/pdf-design.ts';
import { createApp } from './app.ts';
import { Store } from './store.ts';

describe('finished PDF defaults on job submission', () => {
  it.each([false, true])('starts a new job with the finished format when a legacy reference is %s', async (savedReference) => {
    // Given: an empty workbench, optionally with a legacy reference selected.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-default-test-'));
    const store = new Store(directory);
    const { app } = createApp({ store, apiConfigured: false });
    try {
      if (savedReference) {
        const form = new FormData();
        form.set('title', '기존 참고');
        form.set('note', '기존 크기 설정');
        form.set('pdfDesign', JSON.stringify({ fontSize: 12, margins: 'wide', stepLayout: 'flow' }));
        form.set('file', new File([Buffer.from('%PDF-1.4\n')], '참고.pdf', { type: 'application/pdf' }));
        const reference = DesignReferenceSchema.parse(await (await app.request('/api/design-references', { method: 'POST', body: form })).json());
        await app.request('/api/design-references/default', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ referenceId: reference.id }),
        });
      }
      const form = new FormData();
      form.set('inputText', '함수 f(x)=x²의 값을 구하시오.');

      // When: a job is submitted through the same HTTP route as the UI.
      const response = await app.request('/api/jobs', { method: 'POST', body: form });
      const job = JobSchema.parse(await response.json());

      // Then: both generation and export receive the finished layout explicitly.
      expect(job.pdfDesign).toMatchObject({ template: 'baeksin-v16', sourceLayout: 'stacked-reference' });
      expect(job.pdfDesign?.fontSize).toBe(savedReference ? 12 : 11);
      expect(job.pdfDesign?.margins).toBe(savedReference ? 'wide' : 'standard');
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps a stored legacy layout without silently changing its explicit settings', () => {
    // Given: a saved pre-finished design.
    const legacy = { fontSize: 10, margins: 'compact', stepLayout: 'separate', template: 'baeksin-v16' };
    // When: it is loaded from persistent storage.
    const parsed = PdfDesignSchema.parse(legacy);
    // Then: compatibility parsing preserves exactly those settings.
    expect(parsed).toEqual(legacy);
  });
});
