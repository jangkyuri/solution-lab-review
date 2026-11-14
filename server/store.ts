import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CaseSchema, hasRemainingQuestions, JobSchema, SourceFileSchema } from '../shared/contracts.ts';
import type { ApprovedCase, Job, SourceFile } from '../shared/contracts.ts';
import { AppError } from './errors.ts';
import { ReadingSchema } from './generation-schemas.ts';
import type { Reading } from './generation-schemas.ts';

const JsonRowSchema = z.object({ json: z.string() });
const StoredFileSchema = SourceFileSchema.extend({ diskPath: z.string(), jobId: z.string() });
export type StoredFile = z.infer<typeof StoredFileSchema>;

export class Store {
  readonly dataDir: string;
  readonly uploadsDir: string;
  readonly database: DatabaseSync;

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    mkdirSync(this.uploadsDir, { recursive: true });
    this.database = new DatabaseSync(path.join(this.dataDir, 'solution-lab.sqlite'));
    this.database.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_readings (job_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS design_references (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS design_reference_default (
        slot INTEGER PRIMARY KEY CHECK (slot = 1),
        reference_id TEXT NOT NULL REFERENCES design_references(id) ON DELETE CASCADE
      );`);
    for (const job of this.listJobs()) {
      if (job.status === 'running') this.saveJob({ ...job, status: 'failed', error: '앱이 다시 시작되어 작업이 중단됐습니다. 다시 실행해주세요.', updatedAt: new Date().toISOString() }, 'interrupted');
    }
  }

  close(): void { this.database.close(); }

  listJobs(): Job[] {
    return this.database.prepare('SELECT json FROM jobs ORDER BY rowid DESC').all().map((row) => JobSchema.parse(JSON.parse(JsonRowSchema.parse(row).json)));
  }

  getJob(id: string): Job {
    const row = this.database.prepare('SELECT json FROM jobs WHERE id = ?').get(id);
    if (!row) throw new AppError(404, '작업을 찾지 못했습니다.');
    return JobSchema.parse(JSON.parse(JsonRowSchema.parse(row).json));
  }

  getReading(jobId: string): Reading {
    const row = this.database.prepare('SELECT json FROM job_readings WHERE job_id = ?').get(jobId);
    if (!row) throw new AppError(500, '저장한 문항 판독 기록을 찾지 못했습니다.');
    return ReadingSchema.parse(JSON.parse(JsonRowSchema.parse(row).json));
  }

  saveJob(job: Job, reason: string | null, reading?: Reading): Job {
    const valid = JobSchema.parse(job);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (reason !== null) {
        const previous = this.database.prepare('SELECT json FROM jobs WHERE id = ?').get(job.id);
        if (previous) this.database.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)').run(randomUUID(), job.id, new Date().toISOString(), reason, JsonRowSchema.parse(previous).json);
      }
      this.database.prepare('INSERT INTO jobs (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(valid.id, JSON.stringify(valid));
      if (reading) this.database.prepare('INSERT INTO job_readings (job_id,json) VALUES (?,?) ON CONFLICT(job_id) DO UPDATE SET json=excluded.json').run(valid.id, JSON.stringify(reading));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return valid;
  }

  addFile(file: SourceFile, jobId: string, diskPath: string): void {
    const record = StoredFileSchema.parse({ ...file, jobId, diskPath });
    this.database.prepare('INSERT INTO files VALUES (?,?,?)').run(file.id, jobId, JSON.stringify(record));
  }

  getFile(id: string): StoredFile {
    const row = this.database.prepare('SELECT json FROM files WHERE id=?').get(id);
    if (!row) throw new AppError(404, '첨부파일을 찾지 못했습니다.');
    return StoredFileSchema.parse(JSON.parse(JsonRowSchema.parse(row).json));
  }

  filesForJob(jobId: string): StoredFile[] {
    return this.database.prepare('SELECT json FROM files WHERE job_id=? ORDER BY rowid').all(jobId).map((row) => StoredFileSchema.parse(JSON.parse(JsonRowSchema.parse(row).json)));
  }

  listCases(): ApprovedCase[] {
    return this.database.prepare('SELECT json FROM cases ORDER BY rowid DESC').all().map((row) => CaseSchema.parse(JSON.parse(JsonRowSchema.parse(row).json)));
  }

  listRevisions(jobId: string): { readonly id: string; readonly createdAt: string; readonly reason: string; readonly job: Job }[] {
    const rows = this.database.prepare('SELECT id, created_at, reason, json FROM revisions WHERE job_id=? ORDER BY rowid DESC').all(jobId);
    const schema = z.object({ id: z.string(), created_at: z.string(), reason: z.string(), json: z.string() });
    return rows.map((row) => {
      const record = schema.parse(row);
      return { id: record.id, createdAt: record.created_at, reason: record.reason, job: JobSchema.parse(JSON.parse(record.json)) };
    });
  }

  getJobRevision(jobId: string, revisionId: string): Job | undefined {
    const row = this.database.prepare('SELECT json FROM revisions WHERE job_id=? AND id=?').get(jobId, revisionId);
    return row ? JobSchema.parse(JSON.parse(JsonRowSchema.parse(row).json)) : undefined;
  }

  removeCase(jobId: string): void { this.database.prepare('DELETE FROM cases WHERE job_id=?').run(jobId); }

  approve(job: Job): Job {
    if (job.status === 'needs_review') throw new AppError(409, '먼저 저장된 풀이 초안을 확인해주세요.');
    if (!job.result || job.status === 'running') throw new AppError(409, '검토할 풀이 결과가 있어야 승인할 수 있습니다.');
    if (hasRemainingQuestions(job)) throw new AppError(409, '문항 작성을 모두 마친 뒤 검토를 완료할 수 있습니다.');
    const now = new Date().toISOString();
    const supplemented = job.mode === 'supplement';
    const example: ApprovedCase = {
      id: `case-${job.id}`, title: job.title, subject: job.subject, sourceJobId: job.id,
      sourceType: supplemented ? 'approved_supplement' : 'approved_generated',
      problemText: job.result.questions.map((question) => question.problemText).join('\n'),
      teacherFlow: job.result.questions.flatMap((question) => supplemented ? question.steps.map((step) => step.originalStep) : question.steps.map((step) => step.title + ': ' + step.explanation)),
      graphLinks: job.result.questions.flatMap((question) => question.steps.flatMap((step) => step.graph ? [step.graph.explanation] : [])),
      reviewNote: job.reviewNote, createdAt: now,
    };
    this.database.prepare('INSERT INTO cases VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET json=excluded.json').run(example.id, job.id, JSON.stringify(example));
    return this.saveJob({ ...job, status: 'approved', updatedAt: now }, 'approved');
  }
}
