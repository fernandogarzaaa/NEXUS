import type { CanonicalEntity } from "../domain/schemas";
import type { MappingFile } from "./mapping";
import type { SourceAdapter, SourceRecord } from "./types";

// Read-only REST adapter. Issues GET requests only; follows an optional
// next-page link; never sends a body. The bearer token is read from the
// environment variable the mapping names, so tokens never live in files.

const MAX_PAGES = 200;

export type FetchLike = (input: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function getPath(obj: unknown, dotPath: string | undefined): unknown {
  if (!dotPath) return obj;
  return dotPath.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

export class RestSourceAdapter implements SourceAdapter {
  readonly kind = "rest" as const;
  readonly name: string;

  constructor(
    private readonly mapping: MappingFile,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly env: Record<string, string | undefined> = process.env
  ) {
    this.name = `${mapping.name} (rest)`;
  }

  async fetch(entity: CanonicalEntity): Promise<SourceRecord[]> {
    const em = this.mapping.entities[entity];
    if (!em) throw new Error(`Mapping "${this.mapping.name}" has no entry for entity "${entity}"`);
    if (em.source.type !== "rest") throw new Error(`Entity "${entity}" is not a REST source`);
    const { url, recordsPath, nextUrlPath, authEnv, headers } = em.source;

    const requestHeaders: Record<string, string> = { accept: "application/json", ...(headers ?? {}) };
    if (authEnv) {
      const token = this.env[authEnv];
      if (!token) throw new Error(`Environment variable ${authEnv} (bearer token for ${url}) is not set`);
      requestHeaders.authorization = `Bearer ${token}`;
    }

    const out: SourceRecord[] = [];
    let next: string | undefined = url;
    let page = 0;
    while (next && page < MAX_PAGES) {
      page += 1;
      const res = await this.fetchImpl(next, { method: "GET", headers: requestHeaders });
      if (!res.ok) throw new Error(`GET ${next} failed with HTTP ${res.status}`);
      const body = await res.json();
      const records = getPath(body, recordsPath);
      if (!Array.isArray(records)) {
        throw new Error(`GET ${next}: expected an array at "${recordsPath ?? "<body>"}"`);
      }
      records.forEach((raw, i) => {
        const row: Record<string, unknown> = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : { value: raw };
        out.push({
          entity,
          sourceId: String(row[em.sourceIdField] ?? "").trim(),
          raw: row,
          locator: `${next}#${i}`,
        });
      });
      const nextValue = nextUrlPath ? getPath(body, nextUrlPath) : undefined;
      next = typeof nextValue === "string" && nextValue.length > 0 ? nextValue : undefined;
    }
    if (next) throw new Error(`GET ${url}: more than ${MAX_PAGES} pages; refusing to continue`);
    return out;
  }
}
