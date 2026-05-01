import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

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

export async function loadDataset() {
  const repoRoot = process.cwd();
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

