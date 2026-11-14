import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const workspaceRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

export type ReferenceRules = {
  readonly text: string;
  readonly sourcePath: string;
};

export async function getRules(): Promise<ReferenceRules> {
  const sourcePath = resolve(workspaceRoot, "수학_손풀이_보충해설_제작기준.md");
  return { text: await readFile(sourcePath, "utf8"), sourcePath };
}
