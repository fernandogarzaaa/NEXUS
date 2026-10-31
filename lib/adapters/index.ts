import fs from "node:fs";
import path from "node:path";
import type { CanonicalEntity } from "../domain/schemas";
import type { NexusState } from "../domain/state";
import { CsvSourceAdapter } from "./csvAdapter";
import { mappedEntities, parseMappingFile, type MappingFile } from "./mapping";
import { reconcile, type ReconciliationReport } from "./reconcile";
import { RestSourceAdapter, type FetchLike } from "./restAdapter";
import type { SourceAdapter } from "./types";

export type { SourceAdapter, SourceRecord } from "./types";
export type { MappingFile, EntityMapping, MapResult, MappedRow, QuarantinedRow } from "./mapping";
export type { ReconciliationReport, EntityReconciliation } from "./reconcile";
export { parseMappingFile, mapRow, mappedEntities } from "./mapping";
export { reconcileEntity, summarizeReconciliation } from "./reconcile";
export { CsvSourceAdapter } from "./csvAdapter";
export { RestSourceAdapter } from "./restAdapter";
export { parseCsv } from "./csv";

export interface LoadedMapping {
  mapping: MappingFile;
  baseDir: string;
}

export function loadMappingFile(mappingPath: string): LoadedMapping {
  const abs = path.resolve(mappingPath);
  const json = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
  return { mapping: parseMappingFile(json), baseDir: path.dirname(abs) };
}

export interface AdapterOptions {
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
}

/** Build the read-only adapter each mapped entity needs (csv or rest). */
export function createAdapters(
  loaded: LoadedMapping,
  opts: AdapterOptions = {}
): Partial<Record<CanonicalEntity, SourceAdapter>> {
  const out: Partial<Record<CanonicalEntity, SourceAdapter>> = {};
  let csv: CsvSourceAdapter | undefined;
  let rest: RestSourceAdapter | undefined;
  for (const entity of mappedEntities(loaded.mapping)) {
    const source = loaded.mapping.entities[entity]!.source;
    if (source.type === "csv") {
      csv ??= new CsvSourceAdapter(loaded.mapping, loaded.baseDir);
      out[entity] = csv;
    } else {
      rest ??= new RestSourceAdapter(loaded.mapping, opts.fetchImpl, opts.env);
      out[entity] = rest;
    }
  }
  return out;
}

export async function runReconciliation(
  mappingPath: string,
  state: NexusState,
  opts: AdapterOptions & { entities?: CanonicalEntity[] } = {}
): Promise<ReconciliationReport> {
  const loaded = loadMappingFile(mappingPath);
  const entities = opts.entities ?? mappedEntities(loaded.mapping);
  return reconcile(loaded.mapping, createAdapters(loaded, opts), state, entities);
}
