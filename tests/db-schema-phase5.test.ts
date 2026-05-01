import { describe, expect, it } from "bun:test";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

describe("phase 5 db schema migration", () => {
  it("includes hallucination_report on run_cases", async () => {
    const migDir = path.join(import.meta.dir, "../packages/db/src/migrations");
    const files = await readdir(migDir);
    const sqlFile = files.find((f) => f.endsWith(".sql") && f !== "meta");
    expect(sqlFile).toBeDefined();
    const sql = await readFile(path.join(migDir, sqlFile!), "utf-8");
    expect(sql).toContain("run_cases");
    expect(sql).toContain("hallucination_report");
  });
});
