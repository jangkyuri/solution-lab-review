import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { CatalogEntry } from "../shared/contracts.ts";
import { workspaceRoot } from "./reference-rules.ts";

const FileRowSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  url: z.string().url(),
  path: z.string(),
  subject: z.object({ label: z.string(), basis: z.string(), status: z.string() }),
  stage: z.string(),
  contentReviewed: z.boolean(),
  sizeDuplicateCandidateGroup: z.string().nullable(),
});

const SnapshotSchema = z.object({ files: z.array(FileRowSchema) });
const SampleSchema = z.object({
  sampleId: z.string(),
  id: z.string(),
  stage: z.string(),
  localPath: z.string(),
});
const SelectionSchema = z.object({ samples: z.array(SampleSchema) });
type FileRow = z.infer<typeof FileRowSchema>;
type Sample = z.infer<typeof SampleSchema>;

export type CatalogSearch = {
  readonly query: string;
  readonly subject: string;
  readonly limit: number;
};

function mapCatalog(
  files: readonly FileRow[],
  samples: readonly Sample[],
  availableLocalPaths: ReadonlySet<string>,
): readonly CatalogEntry[] {
  const selected = new Map(samples.map((sample) => [sample.id, sample]));
  // A repeated Drive identity is one file; size-based candidates remain separate files.
  const uniqueFiles = new Map<string, FileRow>();
  for (const file of files) {
    if (!uniqueFiles.has(file.id)) uniqueFiles.set(file.id, file);
  }
  return [...uniqueFiles.values()].map((file) => {
    const sample = selected.get(file.id);
    return {
      id: file.id,
      title: file.title,
      subject: file.subject.label,
      path: file.path,
      url: file.url,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      stage: file.stage,
      contentReviewed: file.contentReviewed,
      sampleId: sample?.sampleId ?? null,
      sampleStage: sample?.stage ?? null,
      localPath: sample && availableLocalPaths.has(sample.localPath) ? sample.localPath : null,
      classificationBasis: file.subject.basis,
      classificationStatus: file.subject.status,
      sizeDuplicateCandidateGroup: file.sizeDuplicateCandidateGroup,
    };
  });
}

export function normalizeCatalog(
  snapshot: unknown,
  selection: unknown,
  availableLocalPaths: ReadonlySet<string> = new Set(),
): readonly CatalogEntry[] {
  return mapCatalog(
    SnapshotSchema.parse(snapshot).files,
    SelectionSchema.parse(selection).samples,
    availableLocalPaths,
  );
}

function isInsideWorkspace(filePath: string): boolean {
  const fromWorkspace = relative(workspaceRoot, filePath);
  return fromWorkspace !== ".." && !fromWorkspace.startsWith(`..${sep}`) && !isAbsolute(fromWorkspace);
}

async function availableLocalPath(sample: Sample): Promise<string | null> {
  const candidate = resolve(workspaceRoot, sample.localPath);
  if (!isInsideWorkspace(candidate)) return null;
  try {
    return isInsideWorkspace(await realpath(candidate)) ? sample.localPath : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function getCatalog(): Promise<readonly CatalogEntry[]> {
  const catalogFolder = resolve(workspaceRoot, "수학_손풀이_학습", "목록");
  const [snapshotText, selectionText] = await Promise.all([
    readFile(resolve(catalogFolder, "전체목록_20261106.json"), "utf8"),
    readFile(resolve(catalogFolder, "미적1_표본12_선정.json"), "utf8"),
  ]);
  const snapshot = SnapshotSchema.parse(JSON.parse(snapshotText));
  const selection = SelectionSchema.parse(JSON.parse(selectionText));
  const availablePaths = await Promise.all(selection.samples.map(availableLocalPath));
  return mapCatalog(
    snapshot.files,
    selection.samples,
    new Set(availablePaths.filter((path): path is string => path !== null)),
  );
}

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
}

export function searchEntries(
  entries: readonly CatalogEntry[],
  search: CatalogSearch,
): readonly CatalogEntry[] {
  const tokens = search.query.trim().split(/\s+/u).filter(Boolean).map(compact);
  const subject = compact(search.subject);
  const matches = entries.filter((entry) => {
    if (subject && subject !== "전체" && !compact(entry.subject).includes(subject)) return false;
    const metadata = compact(`${entry.title} ${entry.path} ${entry.subject}`);
    return tokens.every((token) => metadata.includes(token));
  });
  const titleScore = (entry: CatalogEntry) => tokens.filter((token) => compact(entry.title).includes(token)).length;
  matches.sort((left, right) =>
    titleScore(right) - titleScore(left)
    || Number(right.sampleId !== null) - Number(left.sampleId !== null)
    || left.title.localeCompare(right.title, "ko-KR"),
  );
  return matches.slice(0, Math.max(0, Math.min(500, Math.floor(search.limit))));
}

export async function searchCatalog(
  query = "",
  subject = "",
  limit = 100,
): Promise<readonly CatalogEntry[]> {
  return searchEntries(await getCatalog(), { query, subject, limit });
}
