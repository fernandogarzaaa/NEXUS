import type { CanonicalEntity } from "../domain/schemas";

// A SourceRecord is one row/object as the external system presented it.
// Adapters are read-only by construction: the interface has a single
// fetch method and no write path exists anywhere in lib/adapters.

export interface SourceRecord {
  /** The external system's own identifier for this row (per mapping.sourceIdField). */
  sourceId: string;
  entity: CanonicalEntity;
  /** Raw field values exactly as received (strings for CSV, JSON values for REST). */
  raw: Record<string, unknown>;
  /** Where the row came from, for the report: "shipments.csv:12" or a URL + index. */
  locator: string;
}

export interface SourceAdapter {
  readonly name: string;
  readonly kind: "csv" | "rest";
  /** Read every record of one entity from the source. Never mutates the source. */
  fetch(entity: CanonicalEntity): Promise<SourceRecord[]>;
}
