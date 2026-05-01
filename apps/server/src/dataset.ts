import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ClinicalExtractionSchema, sha256Hex } from "@test-evals/shared";

export type DatasetCase = {
  transcript_id: string;
  transcript_path: string;
  gold_path: string;
  transcript: string;
  gold: unknown;
  transcript_sha256: string;
};

function withoutExt(filename: string) {
  return filename.replace(/\.[^/.]+$/, "");
}

async function findRepoRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
    path.dirname(fileURLToPath(import.meta.url)),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
  ];

  for (const start of candidates) {
    let cur = start;
    for (let i = 0; i < 8; i++) {
      const schemaPath = path.join(cur, "data", "schema.json");
      try {
        await access(schemaPath);
        return cur;
      } catch {
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }
  }

  throw new Error("Could not locate repo root (missing data/schema.json).");
}

export async function loadDataset() {
  const repoRoot = await findRepoRoot();
  const transcriptsDir = path.join(repoRoot, "data", "transcripts");
  const goldDir = path.join(repoRoot, "data", "gold");

  const transcriptFiles = (await readdir(transcriptsDir))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const cases: DatasetCase[] = [];
  for (const tf of transcriptFiles) {
    const id = withoutExt(tf);
    const transcriptPath = path.join(transcriptsDir, tf);
    const goldPath = path.join(goldDir, `${id}.json`);

    const transcript = await readFile(transcriptPath, "utf-8");
    const goldRaw = await readFile(goldPath, "utf-8");
    const goldJson = JSON.parse(goldRaw) as unknown;

    // Validate gold now so later phases can trust it.
    ClinicalExtractionSchema.parse(goldJson);

    cases.push({
      transcript_id: id,
      transcript_path: transcriptPath,
      gold_path: goldPath,
      transcript,
      gold: goldJson,
      transcript_sha256: sha256Hex(transcript),
    });
  }

  return cases;
}

