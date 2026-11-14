import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobPatchSchema, JobSchema } from '../shared/contracts.ts';
import { BAEKSIN_V16_PDF_DESIGN, DEFAULT_PDF_DESIGN, LEGACY_PDF_DESIGN } from '../shared/pdf-design.ts';
import { createApp } from './app.ts';
import { jobFixture } from './generation-fixtures.ts';
import { renderPdfTex } from './pdf-template.ts';
import { Store } from './store.ts';

const mapping = { questionNumber: '21', fileId: 'exam-id', page: 1, trim: [24, 24, 24, 24], widthBp: 291.6 };
const exam = { id: 'exam-id', name: 'exam.pdf', mimeType: 'application/pdf', size: 100, role: 'exam', url: '/api/files/exam-id' };
const assets = [{ localName: 'source-1.pdf', name: 'exam.pdf', mimeType: 'application/pdf', role: 'exam_and_handwriting', sourceFileIds: ['handwriting-id', 'exam-id'] }] as const;

function fixture() {
  return JobSchema.parse({
    ...jobFixture, status: 'ready', pdfDesign: BAEKSIN_V16_PDF_DESIGN, files: [exam], originalProblems: [mapping],
    result: { summary: '', references: [], limitations: [], questions: [{
      number: '21', problemText: 'TYPED_PROBLEM_SENTINEL', firstDecision: '', variables: [], observedOrder: [],
      steps: [], answer: '4', uncertainties: [], checks: { math: [], sequence: [], graph: [] },
    }] },
  });
}

describe('original exam problem recaps', () => {
  it('preserves the explicit source mapping at the PATCH boundary', () => {
    // Given: a verified source crop described independently of model output.
    // When: the normal job PATCH contract parses it.
    const patch = JobPatchSchema.parse({ originalProblems: [mapping] });
    // Then: the mapping survives with exact page, trim and physical width.
    expect(patch).toEqual({ originalProblems: [mapping] });
  });

  it.each([BAEKSIN_V16_PDF_DESIGN, LEGACY_PDF_DESIGN, DEFAULT_PDF_DESIGN])('uses the attached source crop in template $template', (pdfDesign) => {
    // Given: the staged source merges identical exam and handwriting attachments.
    const job = JobSchema.parse({ ...fixture(), pdfDesign });
    // When: the student PDF is rendered.
    const body = renderPdfTex(job, assets, new Map()).split(String.raw`\begin{document}`)[1] ?? '';
    // Then: its recap preserves original pixels and never emits the typed substitute.
    expect(body).toContain(String.raw`\includegraphics[page=1,trim=24bp 24bp 24bp 24bp,clip,width=291.6bp]{source-1.pdf}`);
    expect(body).not.toContain('TYPED');
    expect(body).toMatch(/\\(?:baeksinimagerecap|setimagesupplement)\{21\}/u);
    expect(body).not.toContain(String.raw`\textbf{21.}`);
  });

  it('rejects a mapped source that is absent from staged attachments', () => {
    // Given: valid mapping data without its actual attached file.
    // When / Then: rendering fails instead of substituting typed text.
    expect(() => renderPdfTex(fixture(), [], new Map())).toThrow();
  });

  it('allows a source link for a pending question without adding it to a partial export', () => {
    const job = JobSchema.parse({ ...fixture(), status: 'awaiting_next',
      progress: { questionNumbers: ['21', '22'], completedCount: 1 },
      originalProblems: [mapping, { ...mapping, questionNumber: '22', page: 2 }],
    });

    const body = renderPdfTex(job, assets, new Map()).split(String.raw`\begin{document}`)[1] ?? '';

    expect(body).toContain(String.raw`\baeksinimagerecap{21}`);
    expect(body).not.toContain(String.raw`\baeksinimagerecap{22}`);
    expect(body).not.toContain('page=2,trim=');
  });

  it.each([
    { originalProblems: [{ ...mapping, trim: [24, Number.POSITIVE_INFINITY, 24, 24] }] },
    { originalProblems: [{ ...mapping, widthBp: Number.NaN }] },
    { originalProblems: [mapping, mapping] },
    { originalProblems: [{ ...mapping, diskPath: 'C:/outside.pdf' }] },
  ])('rejects malformed or ambiguous crop metadata at the input boundary', (input) => {
    // Given: untrusted crop coordinates or an ambiguous question association.
    // When: the PATCH contract parses the request.
    const parsed = JobPatchSchema.safeParse(input);
    // Then: unsafe metadata cannot enter a stored job.
    expect(parsed.success).toBe(false);
  });

  it.each([
    { ...exam, role: 'handwriting' },
    { ...exam, mimeType: 'text/plain' },
    { ...exam, mimeType: 'image/png' },
  ])('rejects a source with role $role and MIME $mimeType when it cannot supply the mapped page', (file) => {
    // Given: a foreign source role, unsupported MIME or multi-page image request.
    const job = JobSchema.parse({ ...fixture(), files: [file], originalProblems: [{ ...mapping, page: 2 }] });
    // When / Then: rendering rejects the source instead of falling back to transcription.
    expect(() => renderPdfTex(job, assets, new Map())).toThrow();
  });

  it('persists a mapping-only PATCH without changing the generated result or ready state', async () => {
    // Given: a finished job with no original crop association yet.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-original-patch-'));
    const store = new Store(directory);
    try {
      const job = JobSchema.parse({ ...fixture(), originalProblems: [] });
      store.saveJob(job, 'generated');
      const { app } = createApp({ store, apiConfigured: false });
      // When: the verified source is attached through normal PATCH.
      const response = await app.request(`/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalProblems: [mapping] }) });
      // Then: this display-only edit preserves model content and retains a recoverable revision.
      expect(response.status).toBe(200);
      const updated = JobSchema.parse(await response.json());
      expect(updated.originalProblems).toEqual([mapping]);
      expect(updated.result).toEqual(job.result);
      expect(updated.status).toBe('ready');
      expect(store.listRevisions(job.id)).toHaveLength(1);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { ...mapping, fileId: 'foreign-file' },
    { ...mapping, questionNumber: '22' },
    { ...mapping, page: 0 },
    { ...mapping, trim: [-1, 24, 24, 24] },
    { ...mapping, widthBp: 0 },
  ])('rejects invalid original source metadata $fileId $questionNumber $page $widthBp', async (invalid) => {
    // Given: an existing job and a proposed invalid association.
    const directory = await mkdtemp(path.join(tmpdir(), 'solution-lab-original-patch-'));
    const store = new Store(directory);
    try {
      const job = fixture();
      store.saveJob(job, 'generated');
      const { app } = createApp({ store, apiConfigured: false });
      // When: the normal PATCH endpoint receives the mapping.
      const response = await app.request(`/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalProblems: [invalid] }) });
      // Then: it rejects the request without changing the job or its history.
      expect(response.status).toBe(400);
      expect(store.getJob(job.id)).toEqual(job);
      expect(store.listRevisions(job.id)).toHaveLength(0);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
