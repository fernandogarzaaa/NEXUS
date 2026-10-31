import { z } from "zod";
import { CANONICAL_ENTITIES, canonicalSchemas, type CanonicalEntity } from "../domain/schemas";

// ---------------------------------------------------------------------------
// Mapping file: declares, per canonical entity, where source rows come from
// and how each canonical field is derived from the raw row. Evaluating a
// mapping never touches the source or the store; it is a pure function from
// raw row -> canonical candidate + errors.
// ---------------------------------------------------------------------------

const TRANSFORMS = [
  "string",
  "number",
  "integer",
  "boolean",
  "isoDate",
  "kgToLbs",
  "kmToMiles",
  "percentToRatio",
  "stringList",
] as const;
export type Transform = (typeof TRANSFORMS)[number];

export interface FieldRule {
  from?: string;
  template?: string;
  const?: unknown;
  object?: Record<string, FieldRule>;
  presentWhen?: string;
  map?: Record<string, unknown>;
  transform?: Transform;
  itemTemplate?: string;
  default?: unknown;
  nullIfEmpty?: boolean;
}

const fieldRuleSchema: z.ZodType<FieldRule> = z.lazy(() =>
  z
    .object({
      from: z.string().optional(),
      template: z.string().optional(),
      const: z.unknown().optional(),
      object: z.record(z.string(), fieldRuleSchema).optional(),
      presentWhen: z.string().optional(),
      map: z.record(z.string(), z.unknown()).optional(),
      transform: z.enum(TRANSFORMS).optional(),
      itemTemplate: z.string().optional(),
      default: z.unknown().optional(),
      nullIfEmpty: z.boolean().optional(),
    })
    .strict()
);

const csvSource = z.object({ type: z.literal("csv"), path: z.string().min(1) }).strict();
const restSource = z
  .object({
    type: z.literal("rest"),
    url: z.string().url(),
    /** Dot path to the array of records inside the response body (default: the body itself). */
    recordsPath: z.string().optional(),
    /** Dot path to a next-page URL inside the response body; followed until null/absent. */
    nextUrlPath: z.string().optional(),
    /** Name of an environment variable holding a bearer token. Never the token itself. */
    authEnv: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const entityMappingSchema = z
  .object({
    source: z.discriminatedUnion("type", [csvSource, restSource]),
    sourceIdField: z.string().min(1),
    fields: z.record(z.string(), fieldRuleSchema),
    reconcile: z.object({ ignoreFields: z.array(z.string()).default([]) }).default({ ignoreFields: [] }),
  })
  .strict();

export const mappingFileSchema = z
  .object({
    name: z.string().min(1),
    system: z.string().min(1),
    readOnly: z.literal(true),
    entities: z.object({
      shipment: entityMappingSchema.optional(),
      driver: entityMappingSchema.optional(),
      vehicle: entityMappingSchema.optional(),
      facility: entityMappingSchema.optional(),
    }),
  })
  .strict();

export type EntityMapping = z.infer<typeof entityMappingSchema>;
export type MappingFile = z.infer<typeof mappingFileSchema>;
export type SourceSpec = EntityMapping["source"];

export function parseMappingFile(json: unknown): MappingFile {
  const parsed = mappingFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid mapping file: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function mappedEntities(mapping: MappingFile): CanonicalEntity[] {
  return CANONICAL_ENTITIES.filter((e) => mapping.entities[e] !== undefined);
}

// -- Evaluation -------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function fillTemplate(template: string, raw: Record<string, unknown>): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = raw[key];
    if (isEmpty(v)) {
      missing.push(key);
      return "";
    }
    return String(v).trim();
  });
  return { value, missing };
}

function applyTransform(transform: Transform, value: unknown, path: string, errors: string[], rule: FieldRule): unknown {
  const str = typeof value === "string" ? value.trim() : value;
  const num = () => {
    const n = typeof str === "number" ? str : Number(str);
    if (typeof str === "string" && str === "") return NaN;
    return n;
  };
  switch (transform) {
    case "string":
      return String(str);
    case "number": {
      const n = num();
      if (!Number.isFinite(n)) errors.push(`${path}: "${String(value)}" is not a number`);
      return n;
    }
    case "integer": {
      const n = num();
      if (!Number.isInteger(n)) errors.push(`${path}: "${String(value)}" is not an integer`);
      return n;
    }
    case "boolean": {
      const s = String(str).toLowerCase();
      if (["true", "1", "yes", "y"].includes(s)) return true;
      if (["false", "0", "no", "n"].includes(s)) return false;
      errors.push(`${path}: "${String(value)}" is not a boolean`);
      return undefined;
    }
    case "isoDate": {
      const ms = Date.parse(String(str));
      if (Number.isNaN(ms)) {
        errors.push(`${path}: "${String(value)}" is not a parseable date`);
        return undefined;
      }
      return new Date(ms).toISOString();
    }
    case "kgToLbs": {
      const n = num();
      if (!Number.isFinite(n)) {
        errors.push(`${path}: "${String(value)}" is not a number (kg)`);
        return undefined;
      }
      return Math.round(n / 0.45359237);
    }
    case "kmToMiles": {
      const n = num();
      if (!Number.isFinite(n)) {
        errors.push(`${path}: "${String(value)}" is not a number (km)`);
        return undefined;
      }
      return Math.round((n / 1.609344) * 10) / 10;
    }
    case "percentToRatio": {
      const n = num();
      if (!Number.isFinite(n)) {
        errors.push(`${path}: "${String(value)}" is not a percentage`);
        return undefined;
      }
      return Math.round(n) / 100;
    }
    case "stringList": {
      if (Array.isArray(str)) return str.map(String);
      const items = String(str)
        .split(/[;,|]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return rule.itemTemplate ? items.map((item) => fillTemplate(rule.itemTemplate!, { value: item }).value) : items;
    }
  }
}

export function evaluateRule(rule: FieldRule, raw: Record<string, unknown>, path: string, errors: string[]): unknown {
  if (rule.object) {
    if (rule.presentWhen && isEmpty(raw[rule.presentWhen])) return null;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(rule.object)) {
      out[key] = evaluateRule(sub, raw, `${path}.${key}`, errors);
    }
    return out;
  }

  if ("const" in rule) return rule.const; // literal, including null

  let value: unknown;
  if (rule.template !== undefined) {
    const filled = fillTemplate(rule.template, raw);
    value = filled.missing.length > 0 ? undefined : filled.value;
  } else if (rule.from !== undefined) {
    value = raw[rule.from];
    if (typeof value === "string") value = value.trim();
  }

  if (isEmpty(value)) {
    if (rule.nullIfEmpty) return null;
    if ("default" in rule) return rule.default;
    return undefined; // the canonical schema reports it as missing
  }

  if (rule.map) {
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(rule.map, key)) {
      value = rule.map[key];
    } else if ("default" in rule) {
      value = rule.default;
    } else {
      errors.push(`${path}: value "${key}" has no entry in the mapping table`);
      return undefined;
    }
  }

  if (rule.transform) value = applyTransform(rule.transform, value, path, errors, rule);
  return value;
}

export interface MappedRow {
  ok: true;
  entity: CanonicalEntity;
  sourceId: string;
  locator: string;
  canonicalId: string;
  record: Record<string, unknown>;
}

export interface QuarantinedRow {
  ok: false;
  entity: CanonicalEntity;
  sourceId: string;
  locator: string;
  canonicalId: string | null;
  /** Canonical fields the row could not supply (undefined after mapping). */
  missingFields: string[];
  /** Everything else: unmapped enum values, bad numbers/dates, schema violations. */
  errors: string[];
}

export type MapResult = MappedRow | QuarantinedRow;

function getAtPath(obj: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

/** Map one raw source row to a canonical candidate and validate it. Pure. */
export function mapRow(
  entity: CanonicalEntity,
  mapping: EntityMapping,
  raw: Record<string, unknown>,
  locator: string
): MapResult {
  const sourceIdRaw = raw[mapping.sourceIdField];
  const sourceId = isEmpty(sourceIdRaw) ? "" : String(sourceIdRaw).trim();
  const errors: string[] = [];
  const record: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(mapping.fields)) {
    const v = evaluateRule(rule, raw, field, errors);
    if (v !== undefined) record[field] = v;
  }
  const canonicalId = typeof record.id === "string" && record.id.length > 0 ? record.id : null;
  if (sourceId === "") errors.unshift(`source id field "${mapping.sourceIdField}" is empty`);

  const parsed = canonicalSchemas[entity].safeParse(record);
  const missingFields: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const p = issue.path.join(".");
      if (getAtPath(record, issue.path) === undefined) {
        if (!missingFields.includes(p)) missingFields.push(p);
      } else {
        errors.push(`${p}: ${issue.message}`);
      }
    }
  }
  if (errors.length > 0 || missingFields.length > 0 || !canonicalId) {
    if (!canonicalId && !missingFields.includes("id")) missingFields.push("id");
    return { ok: false, entity, sourceId, locator, canonicalId, missingFields, errors };
  }
  return { ok: true, entity, sourceId, locator, canonicalId, record: parsed.data as Record<string, unknown> };
}
