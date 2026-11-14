import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { DesignReferencePatchSchema, DesignReferenceSchema, MAX_DESIGN_REFERENCE_BYTES } from '../shared/design-reference.ts';
import { getDefaultDesignReference } from './design-default.ts';
import { analyzeDesignReference } from './design-reference-analysis.ts';
import { AppError } from './errors.ts';
import type { Store } from './store.ts';
import { fileType } from './uploads.ts';

const metadata = z.string().transform((value) => DesignReferenceSchema.parse(JSON.parse(value)));
const MetadataRowSchema = z.object({ metadata });
const FileRowSchema = MetadataRowSchema.extend({ bytes: z.instanceof(Uint8Array) });
const FormFieldsSchema = z.object({
  title: DesignReferenceSchema.shape.title,
  note: DesignReferenceSchema.shape.note,
  pdfDesign: z.string().max(300),
  curveColor: z.string(),
});

const DefaultSelectionSchema = z.object({ referenceId: DesignReferenceSchema.shape.id.nullable() }).strict();

export function designReferenceRoutes(store: Store): Hono {
  const { database } = store;
  const list = database.prepare('SELECT metadata FROM design_references ORDER BY rowid DESC');
  const insert = database.prepare('INSERT INTO design_references (id, metadata, bytes) VALUES (?, ?, ?)');
  const update = database.prepare(`UPDATE design_references SET metadata = ? WHERE id = ?
    AND (? = 1 OR NOT EXISTS (SELECT 1 FROM design_reference_default WHERE reference_id = ?))`);
  const clearDefault = database.prepare('DELETE FROM design_reference_default WHERE slot = 1');
  const selectDefault = database.prepare(`INSERT INTO design_reference_default (slot, reference_id)
    SELECT 1, id FROM design_references WHERE id = ?
      AND (json_type(metadata, '$.pdfDesign') = 'object' OR json_type(metadata, '$.curveColor') = 'text')
    ON CONFLICT (slot) DO UPDATE SET reference_id = excluded.reference_id`);
  const readMetadata = database.prepare('SELECT metadata FROM design_references WHERE id = ?');
  const readFile = database.prepare('SELECT metadata, bytes FROM design_references WHERE id = ?');

  function getFile(id: string): z.infer<typeof FileRowSchema> {
    const row = readFile.get(id);
    if (!row) throw new AppError(404, '디자인 참고 자료를 찾지 못했습니다.');
    return FileRowSchema.parse(row);
  }

  const router = new Hono();
  router.get('/', (c) => c.json({
    references: list.all().map((row) => MetadataRowSchema.parse(row).metadata),
    defaultReferenceId: getDefaultDesignReference(store)?.id ?? null,
  }));
  router.put('/default', async (c) => {
    const { referenceId } = DefaultSelectionSchema.parse(await c.req.json());
    if (referenceId === null) {
      clearDefault.run();
    } else if (selectDefault.run(referenceId).changes === 0) {
      if (!readMetadata.get(referenceId)) throw new AppError(404, '디자인 참고 자료를 찾지 못했습니다.');
      throw new AppError(400, 'PDF 설정이나 그래프 강조색을 저장한 뒤 기본 디자인으로 선택해주세요.');
    }
    return c.json({ defaultReferenceId: referenceId });
  });
  router.post('/', async (c) => {
    const form = await c.req.raw.formData();
    const [file, ...extraFiles] = form.getAll('file');
    if (!(file instanceof File) || !file.size || extraFiles.length) throw new AppError(400, '디자인 파일 하나를 선택해주세요.');
    if (file.size > MAX_DESIGN_REFERENCE_BYTES) throw new AppError(413, '디자인 파일은 20MB까지 올릴 수 있습니다.');
    const fields = FormFieldsSchema.parse({
      title: form.get('title'), note: form.get('note') ?? '',
      pdfDesign: form.get('pdfDesign') ?? '', curveColor: form.get('curveColor') ?? '',
    });
    const bytes = Buffer.from(await file.arrayBuffer());
    const { mimeType } = fileType(bytes);
    const id = randomUUID();
    const now = new Date().toISOString();
    const baseName = file.name.replaceAll('\\', '/').split('/').pop() ?? '';
    const fileName = Array.from(baseName.replace(/[\u0000-\u001f\u007f]/gu, '')).slice(0, 180).join('').trim() || '디자인 참고 자료';
    const reference = DesignReferenceSchema.parse({
      id, title: fields.title, note: fields.note, fileName, mimeType, size: bytes.length,
      fileUrl: `/api/design-references/${id}/file`, pdfDesign: fields.pdfDesign ? JSON.parse(fields.pdfDesign) : null,
      curveColor: fields.curveColor || null, createdAt: now, updatedAt: now,
    });
    insert.run(id, JSON.stringify(reference), bytes);
    return c.json(reference, 201);
  });
  router.patch('/:id', async (c) => {
    const changes = DesignReferencePatchSchema.parse(await c.req.json());
    const id = c.req.param('id');
    const row = readMetadata.get(id);
    if (!row) throw new AppError(404, '디자인 참고 자료를 찾지 못했습니다.');
    const reference = { ...MetadataRowSchema.parse(row).metadata, ...changes, updatedAt: new Date().toISOString() };
    const hasSettings = reference.pdfDesign !== null || reference.curveColor !== null;
    if (update.run(JSON.stringify(reference), id, hasSettings ? 1 : 0, id).changes === 0) {
      throw new AppError(409, '기본 디자인 지정을 해제한 뒤 마지막 설정을 지워주세요.');
    }
    return c.json(reference);
  });
  router.get('/:id/file', (c) => {
    const { metadata: reference, bytes } = getFile(c.req.param('id'));
    const filename = encodeURIComponent(reference.fileName).replace(/['()*]/gu, (char) => `%${char.charCodeAt(0).toString(16)}`);
    c.header('Content-Type', reference.mimeType);
    c.header('Content-Disposition', `inline; filename*=UTF-8''${filename}`);
    return c.body(new Uint8Array(bytes));
  });
  router.post('/:id/analyze', async (c) => {
    const { metadata: reference, bytes } = getFile(c.req.param('id'));
    const analysis = await analyzeDesignReference({ filename: reference.fileName, mimeType: reference.mimeType, bytes }, { signal: c.req.raw.signal });
    return c.json(analysis);
  });
  return router;
}
