import { describe, expect, it } from "vitest";
import { getCatalog, normalizeCatalog, searchEntries } from "./catalog.ts";

const firstFile = {
  id: "file-A",
  title: "함수의 극한 01.pdf",
  mimeType: "application/pdf",
  sizeBytes: 100,
  url: "https://drive.google.com/file/d/file-A/view",
  path: "자료실/미적1/함수의 극한 01.pdf",
  subject: { label: "미적1", basis: "file_name_only", status: "tentative_metadata_only" },
  stage: "listed_only",
  contentReviewed: false,
  sizeDuplicateCandidateGroup: "SZ001",
} as const;

const secondFile = {
  ...firstFile,
  id: "file-B",
  title: "삼각함수 02.pdf",
  path: "자료실/대수/삼각함수 02.pdf",
  subject: { label: "대수", basis: "folder_path_only", status: "tentative_metadata_only" },
} as const;

const selected = {
  sampleId: "P01",
  id: firstFile.id,
  stage: "selected_not_read",
  localPath: "수학_손풀이_학습/원본/file-A.pdf",
} as const;

describe("catalog normalization", () => {
  it("preserves the snapshot stage when selected sample metadata is attached", () => {
    // Given a listed-only file that was selected for later analysis.
    const catalog = { files: [firstFile] };
    // When the independent selection snapshot is attached.
    const entries = normalizeCatalog(catalog, { samples: [selected] });
    // Then selection does not promote content review or alter provenance.
    expect(entries).toMatchObject([{
      stage: "listed_only",
      contentReviewed: false,
      sampleId: "P01",
      sampleStage: "selected_not_read",
      classificationBasis: "file_name_only",
      classificationStatus: "tentative_metadata_only",
      localPath: null,
    }]);
  });

  it("keeps different IDs with matching byte sizes and duplicate-candidate groups", () => {
    // Given two candidate duplicates and a repeated metadata row for one ID.
    const catalog = { files: [firstFile, secondFile, firstFile] };
    // When metadata is normalized.
    const entries = normalizeCatalog(catalog, { samples: [] });
    // Then only repeated identities are collapsed, not unverified candidates.
    expect(entries.map((entry) => entry.id)).toEqual(["file-A", "file-B"]);
  });

  it("exposes a selected local path only after filesystem availability was established", () => {
    // Given an explicitly checked available local reference.
    const available = new Set([selected.localPath]);
    // When its selected sample is normalized.
    const entries = normalizeCatalog({ files: [firstFile] }, { samples: [selected] }, available);
    // Then the original relative reference is preserved.
    expect(entries[0]?.localPath).toBe(selected.localPath);
  });

  it("rejects malformed numeric metadata at the file boundary", () => {
    // Given a size that is not a file byte count.
    const catalog = { files: [{ ...firstFile, sizeBytes: "100" }] };
    // When external JSON is normalized.
    const normalize = () => normalizeCatalog(catalog, { samples: [] });
    // Then invalid input is rejected rather than silently coerced.
    expect(normalize).toThrow();
  });
});

describe("catalog search", () => {
  it("matches Korean metadata and restricts the subject before applying a limit", () => {
    // Given source rows from two subjects.
    const entries = normalizeCatalog({ files: [firstFile, secondFile] }, { samples: [] });
    // When a compact Korean query and a subject restriction are applied.
    const matches = searchEntries(entries, { query: "함수의극한", subject: "미적1", limit: 1 });
    // Then only the matching subject and identity are returned.
    expect(matches.map((entry) => entry.id)).toEqual(["file-A"]);
  });

  it("requires every query term and never invents a match", () => {
    // Given metadata without a matching second term.
    const entries = normalizeCatalog({ files: [firstFile] }, { samples: [] });
    // When all query terms are required.
    const matches = searchEntries(entries, { query: "극한 적분", subject: "", limit: 100 });
    // Then no unrelated file is returned.
    expect(matches).toEqual([]);
  });
});

describe("existing catalog integration", () => {
  it("imports actual file records without counting folders as learned content", async () => {
    // Given the existing source catalog and selected-sample snapshot.
    // When their records and actual local references are loaded.
    const entries = await getCatalog();
    // Then the source file inventory and independent review states remain intact.
    expect({
      files: entries.length,
      identities: new Set(entries.map((entry) => entry.id)).size,
      reviewed: entries.filter((entry) => entry.contentReviewed).length,
      selected: entries.filter((entry) => entry.sampleId !== null).length,
      local: entries.filter((entry) => entry.localPath !== null).length,
      calculus: entries.filter((entry) => entry.subject === "미적1").length,
      stages: [...new Set(entries.map((entry) => entry.stage))],
    }).toEqual({
      files: 869, identities: 869, reviewed: 0, selected: 12, local: 12,
      calculus: 328, stages: ["listed_only"],
    });
  });
});
