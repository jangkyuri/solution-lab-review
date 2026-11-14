import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeLoader, loadKnowledge } from './knowledge.ts';

const roots: string[] = [];
const corePath = '수학_손풀이_학습/문항별/분리기록/원본핵심_P01.json';
const gapPath = '수학_손풀이_학습/문항별/분리기록/보충필요_P01.json';
const core = {
  track: 'original_core', date: '2026-11-06', customMetadata: 'preserve me',
  problems: [{
    sampleId: 'P01', sourceId: 'source-1', centralArgument: '독립 조건 두 개를 합친다.',
    steps: [
      { stepId: 'P01-S01', sourceEvidence: '첫 조건', mathematicalContent: 'a=1', role: '조건', after: [], branch: 'condition_a' },
      { stepId: 'P01-S02', sourceEvidence: '둘째 조건', mathematicalContent: 'b=2', role: '조건', after: [], branch: 'condition_b' },
      { stepId: 'P01-S03', sourceEvidence: '합류', mathematicalContent: 'a+b=3', role: '합류', after: ['P01-S01', 'P01-S02'], branch: 'main_join' },
    ],
    graphEquationLinks: [{ atStep: 'P01-S01', from: '점', to: 'a=1', mark: '같은 표시' }],
    preserve: ['a,b'], sourceIssueRefs: ['P01-G01'],
  }],
};
const gaps = {
  track: 'supplement_needs', problems: [{ sampleId: 'P01', items: [{
    gapId: 'P01-G01', atStep: 'P01-S03', kind: 'missing_reason', sourceEvidence: '합류',
    studentObstacle: '연결 이유', minimumSupplement: '두 조건을 더한다.', verification: '직접 대입',
  }], needsUserInput: [] }],
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'solution-knowledge-'));
  roots.push(root);
  await writeRecords(root, core, gaps);
  return root;
}

async function writeRecords(root: string, original: unknown, supplement: unknown): Promise<void> {
  const records = [];
  const documents = new Map<string, unknown>([
    [corePath, original], [gapPath, supplement],
    ['수학_손풀이_학습/검증문항/V01_원본핵심.json', { track: 'original_core', problems: [{ sampleId: 'V01' }] }],
  ]);
  for (const [path, document] of documents) {
    const bytes = Buffer.from(JSON.stringify(document));
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    records.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, capturedAt: '2026-11-06T00:00:00Z', records,
    counts: { records: records.length, analyzedProblems: 1, originalSteps: 3, graphEquationLinks: 1, supplementNeeds: 1 },
    approval: { teacherApproval: 'not_inferred' }, rawAssetsIncluded: false,
  }));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('knowledge snapshot boundary', () => {
  it('preserves independent roots and graph mappings while excluding validation records', async () => {
    // Given a verified snapshot with two independent roots and a reserved validation item.
    const loader = new KnowledgeLoader(await fixture());
    // When the snapshot is imported.
    const library = await loader.load();
    // Then source identifiers and partial order survive without promoting the holdout.
    expect(library.problems.map((problem) => problem.sampleId)).toEqual(['P01']);
    expect(library.problems[0]?.steps.map((step) => step.after)).toEqual([[], [], ['P01-S01', 'P01-S02']]);
    expect(library.problems[0]?.graphEquationLinks[0]).toMatchObject({ atStep: 'P01-S01', fromStep: null, toStep: null });
    expect(library.problems[0]?.raw['originalRecord']).toMatchObject({ customMetadata: 'preserve me' });
  });

  it('rejects altered bytes before any previous valid snapshot exists', async () => {
    // Given a file changed without updating its published manifest hash.
    const root = await fixture();
    await writeFile(join(root, corePath), '{}');
    // When a fresh reader imports it.
    const result = new KnowledgeLoader(root).load();
    // Then the damaged snapshot is rejected.
    await expect(result).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects manifest count mismatches even when every record hash is valid', async () => {
    const root = await fixture();
    const path = join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.counts.analyzedProblems += 1;
    await writeFile(path, JSON.stringify(manifest));
    await expect(new KnowledgeLoader(root).load()).rejects.toMatchObject({ code: 'integrity' });
  });

  it('ignores unlisted files rather than importing a partially copied next batch', async () => {
    // Given an unlisted baseline-shaped file beside a published snapshot.
    const root = await fixture();
    await writeFile(join(root, '수학_손풀이_학습/문항별/분리기록/원본핵심_P99.json'), JSON.stringify({ track: 'original_core', problems: [{ sampleId: 'P99' }] }));
    // When the published version is loaded.
    const library = await new KnowledgeLoader(root).load();
    // Then only the manifest-listed baseline is considered active.
    expect(library.problems.map((problem) => problem.sampleId)).toEqual(['P01']);
  });

  it('keeps the last verified snapshot and exposes a warning after an invalid refresh', async () => {
    // Given a successful snapshot already used by the app.
    const root = await fixture();
    const loader = new KnowledgeLoader(root);
    const previous = await loader.load();
    await writeFile(join(root, corePath), '{}');
    // When a concurrently damaged replacement is read.
    const next = await loader.load();
    // Then the app retains its exact previous version and makes the refresh failure visible.
    expect(next.summary.snapshotId).toBe(previous.summary.snapshotId);
    expect(next.problems).toEqual(previous.problems);
    expect(next.warning).not.toBeNull();
  });

  it('rejects references crossing into another problem even when the bytes match', async () => {
    // Given a supplement pointing outside its owning problem.
    const root = await fixture();
    const changed = structuredClone(gaps);
    const item = changed.problems[0]?.items[0];
    if (item) item.atStep = 'P02-S01';
    await writeRecords(root, core, changed);
    // When the structurally invalid, hash-correct snapshot is imported.
    const result = new KnowledgeLoader(root).load();
    // Then the invalid ownership reference is rejected.
    await expect(result).rejects.toMatchObject({ code: 'references' });
  });

  it('rejects cycles rather than inventing a linear order', async () => {
    // Given a dependency cycle in otherwise valid source JSON.
    const root = await fixture();
    const changed = structuredClone(core);
    const first = changed.problems[0]?.steps[0];
    if (first) first.after = ['P01-S03'];
    await writeRecords(root, changed, gaps);
    // When the snapshot is imported.
    const result = new KnowledgeLoader(root).load();
    // Then no generated display ordering conceals the cycle.
    await expect(result).rejects.toMatchObject({ code: 'references' });
  });

  it('rejects a new graph-link shape instead of silently dropping its meaning', async () => {
    // Given a graph link outside the three supported source contracts.
    const root = await fixture();
    const original = { ...core, problems: core.problems.map((problem) => ({ ...problem, graphEquationLinks: [{ unsupportedStep: 'P01-S01' }] })) };
    await writeRecords(root, original, gaps);
    // When its matching-hash snapshot is imported.
    const result = new KnowledgeLoader(root).load();
    // Then the schema change requires an explicit adapter update.
    await expect(result).rejects.toMatchObject({ code: 'schema' });
  });

  it('protects a cached snapshot from accidental caller mutation', async () => {
    // Given a loaded snapshot shared between UI and generation callers.
    const library = await new KnowledgeLoader(await fixture()).load();
    // When a caller attempts to alter the observed source order.
    const mutate = () => library.problems[0]?.steps[0]?.after.push('P01-S03');
    // Then the immutable version cannot be changed in memory.
    expect(mutate).toThrow(TypeError);
  });

  it('imports the baseline and published expansion without importing the reserved validation set', async () => {
    // Given the actual published byte-verified knowledge snapshot.
    // When the default adapter reads its manifest-listed source records.
    const library = await loadKnowledge();
    // Then independent known inventory counts and critical branches remain intact.
    expect(library.summary).toMatchObject({ problemCount: 32, stepCount: 200, graphLinkCount: 81, supplementCount: 166 });
    expect(library.problems.some((problem) => problem.sampleId.startsWith('V'))).toBe(false);
    const p04 = library.problems.find((problem) => problem.sampleId === 'P04');
    expect(p04?.steps.filter((step) => step.after.length === 0).length).toBeGreaterThan(1);
    const p07 = library.problems.find((problem) => problem.sampleId === 'P07');
    expect(p07?.steps.some((step) => step.branch === 'separate_alternative')).toBe(true);
    const manifest = JSON.parse(await readFile(resolve('../solution-lab-knowledge/manifest.json'), 'utf8'));
    expect(library.summary.recordCount).toBe(manifest.records.length);
  }, 30_000);
});
