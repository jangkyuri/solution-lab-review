import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobSchema } from '../shared/contracts.ts';
import { DesignReferenceSchema } from '../shared/design-reference.ts';
import { createApp } from './app.ts';
import { Store } from './store.ts';

const endpoint = '/api/design-references';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+naDsAAAAASUVORK5CYII=', 'base64');
const pdfDesign = { fontSize: 12, margins: 'wide', stepLayout: 'separate' } as const;

function referenceForm(file = new File([image], '그래프.png', { type: 'image/png' })): FormData {
  const body = new FormData();
  body.set('file', file);
  body.set('title', '수업 그래프');
  body.set('note', '좌표와 교점을 명확히 표시');
  body.set('pdfDesign', JSON.stringify(pdfDesign));
  body.set('curveColor', 'brown');
  return body;
}

async function withLibrary(scenario: (store: Store, reopen: () => Store) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'solution-lab-design-reference-'));
  let current = new Store(directory);
  try {
    await scenario(current, () => {
      current.close();
      current = new Store(directory);
      return current;
    });
  } finally {
    current.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('local design references', () => {
  it('keeps the original and reusable settings across reopen and metadata editing', async () => {
    await withLibrary(async (store, reopen) => {
      const { app } = createApp({ store });
      const saved = await app.request(endpoint, { method: 'POST', body: referenceForm() });
      expect(saved.status).toBe(201);
      const created = DesignReferenceSchema.parse(await saved.json());
      expect(created).toMatchObject({ title: '수업 그래프', fileName: '그래프.png', pdfDesign, curveColor: 'brown' });

      const reopened = createApp({ store: reopen() }).app;
      const list = await reopened.request(endpoint);
      expect(await list.json()).toEqual({ references: [created], defaultReferenceId: null });
      const edited = await reopened.request(`${endpoint}/${created.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: '교점 강조', curveColor: null }),
      });
      expect(edited.status).toBe(200);
      expect(await edited.json()).toMatchObject({ note: '교점 강조', curveColor: null, pdfDesign, fileUrl: created.fileUrl });
      const original = await reopened.request(created.fileUrl);
      expect(original.headers.get('Content-Type')).toBe('image/png');
      expect(Buffer.from(await original.arrayBuffer())).toEqual(image);
    });
  });

  it('keeps the library empty when an upload advertises a false file type', async () => {
    await withLibrary(async (store) => {
      const { app } = createApp({ store });
      const falsePng = new File(['<script>test</script>'], 'wrong.png', { type: 'image/png' });
      const saved = await app.request(endpoint, { method: 'POST', body: referenceForm(falsePng) });
      expect(saved.status).toBe(415);
      expect(await (await app.request(endpoint)).json()).toEqual({ references: [], defaultReferenceId: null });
    });
  });

  it('keeps a selected default across reopen and copies its settings only to new jobs', async () => {
    await withLibrary(async (store, reopen) => {
      const { app } = createApp({ store });
      const jobForm = new FormData();
      jobForm.set('inputText', 'x의 값을 구하시오.');
      const existing = JobSchema.parse(await (await app.request('/api/jobs', { method: 'POST', body: jobForm })).json());
      const created = DesignReferenceSchema.parse(await (await app.request(endpoint, { method: 'POST', body: referenceForm() })).json());
      const selected = await app.request(`${endpoint}/default`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ referenceId: created.id }),
      });
      expect(selected.status).toBe(200);
      expect(await selected.json()).toEqual({ defaultReferenceId: created.id });

      const reopened = createApp({ store: reopen() }).app;
      expect(await (await reopened.request(endpoint)).json()).toEqual({ references: [created], defaultReferenceId: created.id });
      const job = await reopened.request('/api/jobs', { method: 'POST', body: jobForm });
      expect(job.status).toBe(201);
      expect(await job.json()).toMatchObject({
        pdfDesign, initialDesign: { referenceId: created.id, title: created.title, curveColor: 'brown' },
      });
      expect(await (await reopened.request(`/api/jobs/${existing.id}`)).json()).toEqual(existing);
    });
  });
});
