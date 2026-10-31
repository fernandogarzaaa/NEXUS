import fs from "node:fs";
import path from "node:path";
import type { CanonicalEntity } from "../domain/schemas";
import type { MappingFile } from "./mapping";
import type { SourceAdapter, SourceRecord } from "./types";
import { parseCsv } from "./csv";

/** Reads CSV extracts referenced by a mapping file. File paths resolve relative to the mapping file. */
export class CsvSourceAdapter implements SourceAdapter {
  readonly kind = "csv" as const;
  readonly name: string;

  constructor(
    private readonly mapping: MappingFile,
    private readonly baseDir: string
  ) {
    this.name = `${mapping.name} (csv)`;
  }

  async fetch(entity: CanonicalEntity): Promise<SourceRecord[]> {
    const em = this.mapping.entities[entity];
    if (!em) throw new Error(`Mapping "${this.mapping.name}" has no entry for entity "${entity}"`);
    if (em.source.type !== "csv") throw new Error(`Entity "${entity}" is not a CSV source`);
    const file = path.resolve(this.baseDir, em.source.path);
    if (!file.startsWith(path.resolve(this.baseDir))) {
      throw new Error(`CSV path "${em.source.path}" escapes the mapping directory`);
    }
    const text = fs.readFileSync(file, "utf8");
    const rows = parseCsv(text);
    const rel = path.basename(file);
    return rows.map((raw, i) => ({
      entity,
      sourceId: String(raw[em.sourceIdField] ?? "").trim(),
      raw,
      locator: `${rel}:${i + 2}`, // +2: 1-based, after the header row
    }));
  }
}
