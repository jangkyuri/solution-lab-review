import { describe, expect, it } from 'vitest';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWriterEvidence, encodeAttachment, selectMethodEvidence } from './generation-input.ts';
import { jobFixture, readingFixture } from './generation-fixtures.ts';
import { pythonExecutable } from './math-engine.ts';
import { runPdfProcess } from './pdf-runtime.ts';
import type { StoredFile } from './store.ts';

const attached = (name: string, role: StoredFile['role'], diskPath: string): StoredFile => ({
  id: name, name, role, diskPath, jobId: jobFixture.id, mimeType: 'image/png', size: 8, url: '',
});

describe('generation attachments and evidence', () => {
  it('reuses clear transcriptions even if the printed question number is missing', async () => {
    const reading = { ...readingFixture, questions: readingFixture.questions.map(question => ({
      ...question, uncertainties: ['문제 발문 앞에는 인쇄된 문항 번호가 보이지 않는다.'],
    })) };
    const files = [attached('원본.png', 'exam', 'not-read.png'), attached('손풀이.png', 'handwriting', 'not-read.png')];
    const evidence = await buildWriterEvidence({ ...jobFixture, mode: 'supplement' }, files, reading);
    expect(evidence).toEqual([]);
  });

  it('reattaches just the matching handwriting when a symbol in the handwriting is unclear', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solution-lab-evidence-'));
    const source = join(directory, 'hand.png');
    try {
      await writeFile(source, Buffer.from('hand-1'));
      const files = [
        attached('문제.pdf', 'exam', 'not-read.png'),
        attached('p.96 Lv.1 1번.png', 'handwriting', source),
        attached('p.96 Lv.1 2번.png', 'handwriting', 'not-read.png'),
      ];
      const reading = { ...readingFixture, questions: readingFixture.questions.map(question => ({
        ...question, uncertainties: ['손풀이 S01에서 지수가 흐려 정확히 판독하기 어렵다.'],
      })) };
      const evidence = await buildWriterEvidence({ ...jobFixture, mode: 'supplement' }, files, reading);
      expect(evidence).toEqual([
        { type: 'input_text', text: JSON.stringify({ attachmentRole: 'handwriting', attachmentName: files[1]?.name }) },
        encodeAttachment('p.96 Lv.1 1번.png', 'image/png', Buffer.from('hand-1')),
      ]);
    } finally {
      await unlink(source);
      await rmdir(directory);
    }
  });

  it('uses explicitly supplied solve references in the first draft and reuses the draft on correction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solution-lab-evidence-'));
    const source = join(directory, 'reference.png');
    try {
      await writeFile(source, Buffer.from('reference'));
      const files = [attached('exam.png', 'exam', 'not-read.png'), attached('reference.png', 'handwriting', source)];
      const first = await buildWriterEvidence(jobFixture, files, readingFixture);
      const correction = await buildWriterEvidence(jobFixture, files, readingFixture, { correction: true });
      expect(first).toEqual([
        { type: 'input_text', text: JSON.stringify({ attachmentRole: 'reference', attachmentName: 'reference.png' }) },
        encodeAttachment('reference.png', 'image/png', Buffer.from('reference')),
      ]);
      expect(correction).toEqual([]);
    } finally {
      await unlink(source);
      await rmdir(directory);
    }
  });

  it('reattaches the confirmed exam page and trim for an unclear problem condition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solution-lab-evidence-'));
    const source = join(directory, 'source.pdf');
    try {
      const script = `from PIL import Image
import sys
first = Image.new("RGB", (110, 130), "blue")
second = Image.new("RGB", (100, 120), "red")
first.save(sys.argv[1], resolution=72.0, save_all=True, append_images=[second])`;
      await runPdfProcess(pythonExecutable(), ['-I', '-c', script, source], directory);
      const file = { ...attached('source.pdf', 'exam', source), mimeType: 'application/pdf' };
      const job = { ...jobFixture, originalProblems: [
        { questionNumber: '1', fileId: file.id, page: 2, trim: [10, 20, 5, 15] as [number, number, number, number], widthBp: 85 },
      ] };
      const reading = { ...readingFixture, questions: readingFixture.questions.map(question => ({
        ...question, uncertainties: ['문제 조건의 부호가 흐려 판독하기 어렵다.'],
      })) };
      const evidence = await buildWriterEvidence(job, [file, attached('other.png', 'exam', 'not-read.png')], reading);
      expect(evidence).toHaveLength(2);
      expect(evidence[0]).toEqual({ type: 'input_text', text: JSON.stringify({
        attachmentRole: 'exam', attachmentName: 'source.pdf · 1번.png', questionNumber: '1',
      }) });
      const image = evidence[1];
      expect(image?.type).toBe('input_image');
      if (image?.type !== 'input_image' || !image.image_url) throw new Error('Missing question crop');
      const png = Buffer.from(image.image_url.slice('data:image/png;base64,'.length), 'base64');
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(170);
      expect(png.readUInt32BE(20)).toBe(170);
    } finally {
      await unlink(source);
      await rmdir(directory);
    }
  });

  it('uses only the mapped exam when the verified crop cannot be rendered', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'solution-lab-evidence-'));
    const source = join(directory, 'source.pdf');
    try {
      const bytes = Buffer.from('%PDF-1.4\nfixture without pages');
      await writeFile(source, bytes);
      const file = { ...attached('source.pdf', 'exam', source), mimeType: 'application/pdf' };
      const job = { ...jobFixture, originalProblems: [
        { questionNumber: '1', fileId: file.id, page: 1, trim: [0, 0, 0, 0] as [number, number, number, number], widthBp: 85 },
      ] };
      const reading = { ...readingFixture, questions: readingFixture.questions.map(question => ({
        ...question, uncertainties: ['시험지에서 주어진 수치가 흐려 판독하기 어렵다.'],
      })) };
      const evidence = await buildWriterEvidence(job, [file, attached('other.png', 'exam', 'not-read.png')], reading);
      expect(evidence).toEqual([
        { type: 'input_text', text: JSON.stringify({ attachmentRole: 'exam', attachmentName: file.name }) },
        encodeAttachment(file.name, file.mimeType, bytes),
      ]);
    } finally {
      await unlink(source);
      await rmdir(directory);
    }
  });

  it('encodes a PDF as an inline file without changing its bytes', () => {
    // Given
    const bytes = Buffer.from('%PDF-1.4\nexam');
    // When
    const content = encodeAttachment('exam.pdf', 'application/pdf', bytes);
    // Then
    expect(content).toEqual({ type: 'input_file', filename: 'exam.pdf', file_data: `data:application/pdf;base64,${bytes.toString('base64')}` });
  });

  it('excludes reserved validation samples even when they match better', () => {
    // Given
    const candidates = [
      { sampleId: 'P01', sourceId: 'source-p', title: '함수 극한', centralArgument: '유리화', steps: [], supplements: [], graphEquationLinks: [], preserve: [], sourceIssueRefs: [] },
      { sampleId: 'V01', sourceId: 'source-v', title: '함수 극한 유리화 함수', centralArgument: '유리화', steps: [], supplements: [], graphEquationLinks: [], preserve: [], sourceIssueRefs: [] },
    ];
    // When
    const result = selectMethodEvidence(candidates, ['함수', '극한', '유리화']);
    // Then
    expect(result.map((item) => item.sampleId)).toEqual(['P01']);
  });

  it('returns no examples when no observed method matches', () => {
    // Given
    const candidates = [{ sampleId: 'P01', sourceId: 'p', title: '삼각함수', centralArgument: '주기', steps: [], supplements: [], graphEquationLinks: [], preserve: [], sourceIssueRefs: [] }];
    // When
    const result = selectMethodEvidence(candidates, ['벡터내적']);
    // Then
    expect(result).toEqual([]);
  });
});
