import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { KnowledgeLibrary, KnowledgeProblem } from '../shared/knowledge.ts';
import type { KnowledgeDocument } from './knowledge-normalize.ts';
import { KnowledgeError, normalizeKnowledge } from './knowledge-normalize.ts';
import { workspaceRoot } from './reference-rules.ts';

const ManifestSchema = z.object({
  schemaVersion: z.literal(1), capturedAt: z.iso.datetime({ offset: true }),
  records: z.array(z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f\d]{64}$/u) })),
  counts: z.object({ records: z.number().int(), analyzedProblems: z.number().int(), originalSteps: z.number().int(), graphEquationLinks: z.number().int(), supplementNeeds: z.number().int() }),
  approval: z.object({ teacherApproval: z.literal('not_inferred') }), rawAssetsIncluded: z.literal(false),
});
const allowedRoots = new Set(['수학_손풀이_보충해설_제작기준.md', '수학_손풀이_학습_진행기록.md']);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function freezeSnapshot(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeSnapshot(nested);
}

function allowedPath(path: string): boolean {
  return !path.includes('\\') && !path.split('/').some((part) => part === '.' || part === '..' || part.length === 0)
    && (allowedRoots.has(path) || (path.startsWith('수학_손풀이_학습/') && !path.includes('/원본/') && /\.(md|json|csv)$/u.test(path)));
}

/** Cache mutation is confined to replacing a complete, verified snapshot. */
export class KnowledgeLoader {
  private previous: KnowledgeLibrary | null = null;
  private pending: Promise<KnowledgeLibrary> | null = null;
  readonly root: string;
  constructor(root: string) { this.root = root; }

  async load(): Promise<KnowledgeLibrary> {
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try { return await this.pending; }
    finally { this.pending = null; }
  }

  private async refresh(): Promise<KnowledgeLibrary> {
    try {
      const library = await this.readSnapshot();
      freezeSnapshot(library);
      this.previous = library;
      return library;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const failure = error instanceof KnowledgeError ? error : new KnowledgeError('schema', '기록 묶음을 읽지 못했습니다. 형식과 저장 상태를 확인해주세요.', { cause: error });
      if (!this.previous) throw failure;
      return { ...this.previous, warning: `새 기록을 가져오지 못해 직전 확인된 기록을 표시합니다. ${failure.message}` };
    }
  }

  private async readSnapshot(): Promise<KnowledgeLibrary> {
    const root = await realpath(this.root);
    const manifestPath = await realpath(resolve(root, 'manifest.json'));
    if (relative(root, manifestPath) !== 'manifest.json') throw new KnowledgeError('integrity', '보관 명세가 선택한 자료실 밖을 가리킵니다.');
    const manifestBytes = await readFile(manifestPath);
    const manifest = ManifestSchema.parse(JSON.parse(utf8.decode(manifestBytes)));
    const seen = new Set<string>();
    const documents: KnowledgeDocument[] = [];
    const captured: { readonly path: string; readonly hash: string }[] = [];
    for (const record of manifest.records) {
      if (!allowedPath(record.path) || seen.has(record.path)) throw new KnowledgeError('integrity', '기록 목록에 허용하지 않은 경로나 중복 경로가 있습니다.');
      seen.add(record.path);
      const path = await realpath(resolve(root, record.path));
      const inside = relative(root, path);
      if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new KnowledgeError('integrity', '기록 경로가 선택한 자료실 밖을 가리킵니다.');
      const bytes = await readFile(path);
      if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw new KnowledgeError('integrity', '기록 내용이 보관 명세와 다릅니다. 저장이 끝난 뒤 다시 가져옵니다.');
      const text = utf8.decode(bytes);
      if (record.path.endsWith('.json')) documents.push({ path: record.path, value: JSON.parse(text) });
      captured.push({ path, hash: record.sha256 });
    }
    const problems = normalizeKnowledge(documents);
    const summary = {
      snapshotId: hash(manifestBytes), capturedAt: manifest.capturedAt, recordCount: manifest.records.length,
      problemCount: problems.length, stepCount: problems.reduce((sum, problem) => sum + problem.steps.length, 0),
      graphLinkCount: problems.reduce((sum, problem) => sum + problem.graphEquationLinks.length, 0),
      supplementCount: problems.reduce((sum, problem) => sum + problem.supplements.length, 0),
      sourcePath: root, teacherApproval: manifest.approval.teacherApproval,
    };
    if (summary.recordCount !== manifest.counts.records || summary.problemCount !== manifest.counts.analyzedProblems
      || summary.stepCount !== manifest.counts.originalSteps || summary.graphLinkCount !== manifest.counts.graphEquationLinks
      || summary.supplementCount !== manifest.counts.supplementNeeds) throw new KnowledgeError('integrity', '기록의 실제 문항·단계 수가 보관 명세와 다릅니다.');
    for (const record of captured) {
      if (hash(await readFile(record.path)) !== record.hash) throw new KnowledgeError('integrity', '가져오는 동안 기록 내용이 변경되었습니다. 다음 실행에서 다시 가져옵니다.');
    }
    if (!manifestBytes.equals(await readFile(manifestPath))) throw new KnowledgeError('integrity', '가져오는 동안 기록 목록이 변경되었습니다. 다음 실행에서 다시 가져옵니다.');
    return { summary, problems, warning: null };
  }
}

const reader = new KnowledgeLoader(resolve(workspaceRoot, 'solution-lab-knowledge'));
export function loadKnowledge(): Promise<KnowledgeLibrary> { return reader.load(); }
export async function getKnowledgeProblem(sampleId: string): Promise<KnowledgeProblem> {
  const library = await loadKnowledge();
  const problem = library.problems.find((item) => item.sampleId === sampleId);
  if (!problem) throw new KnowledgeError('missing', '학습 기준에 포함된 문항을 찾지 못했습니다.');
  return problem;
}
export async function searchKnowledge(query = ''): Promise<KnowledgeLibrary> {
  const library = await loadKnowledge();
  const terms = query.normalize('NFKC').toLocaleLowerCase('ko-KR').split(/\s+/u).filter(Boolean);
  const problems = library.problems.filter((problem) => {
    const text = JSON.stringify(problem).normalize('NFKC').toLocaleLowerCase('ko-KR');
    return terms.every((term) => text.includes(term));
  });
  return { ...library, problems };
}
