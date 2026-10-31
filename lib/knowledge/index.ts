import path from "node:path";
import type { NexusState } from "../domain/state";
import { extractIds, tokenize } from "./text";
import {
  hashText,
  opsDocsFrom,
  recordDocs,
  renderLiveOpsSection,
  renderLiveRecord,
  type KnowledgeDoc,
  type KnowledgeSourceType,
} from "./sources";

// ---------------------------------------------------------------------------
// Retrieval over canonical records and supplied ops docs (BM25, in process,
// no external embedding service). Answers are extractive: every sentence in
// an answer is a retrieved passage with a numbered citation naming its
// source record and timestamp. Before a passage is used it is re-verified
// against the live source; a passage whose source changed or disappeared
// since indexing is excluded as STALE/MISSING. When nothing fresh and
// relevant remains, the answer is NOT_FOUND — never a guess.
// ---------------------------------------------------------------------------

export interface KnowledgeIndex {
  builtAt: string;
  /** Cheap signature of the working set at build time; a change triggers a rebuild. */
  signature: string;
  opsDocsDir: string;
  docs: KnowledgeDoc[];
  postings: Map<string, Array<{ doc: number; tf: number }>>;
  docLengths: number[];
  avgDocLength: number;
}

export interface Citation {
  n: number;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  title: string;
  asOf: string;
  asOfBasis: KnowledgeDoc["asOfBasis"];
  score: number;
}

export interface ExcludedHit {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  reason: "STALE" | "MISSING" | "TOO_OLD";
  detail: string;
}

export type KnowledgeAnswer =
  | {
      status: "ANSWERED";
      question: string;
      answer: string;
      passages: Array<{ n: number; text: string }>;
      citations: Citation[];
      excluded: ExcludedHit[];
      indexBuiltAt: string;
    }
  | {
      status: "NOT_FOUND";
      question: string;
      reason: string;
      excluded: ExcludedHit[];
      indexBuiltAt: string;
    };

export interface AskOptions {
  /** Maximum passages in an answer (default 3). */
  maxPassages?: number;
  /** Reject passages whose record timestamp is older than this (hours). Ops docs and snapshot-dated records are hash-checked instead. */
  maxAgeHours?: number;
  /** Restrict retrieval to these source types. */
  sourceTypes?: KnowledgeSourceType[];
  /** Override "now" for age checks (tests). */
  now?: Date;
}

const K1 = 1.2;
const B = 0.75;
/** Share of the question's content terms a passage must contain to count as relevant. */
const MIN_COVERAGE = 0.5;

export function defaultOpsDocsDir(env: Record<string, string | undefined> = process.env): string {
  // The directory is runtime configuration, so tell Turbopack not to trace
  // it; next.config.ts includes docs/ops explicitly for the routes that read it.
  return path.resolve(/*turbopackIgnore: true*/ env.NEXUS_OPS_DOCS_DIR ?? path.join(process.cwd(), "docs", "ops"));
}

export function stateSignature(state: NexusState): string {
  return [
    state.seed,
    state.shipments.size,
    state.drivers.size,
    state.vehicles.size,
    state.facilities.size,
    state.exceptions.size,
    state.approvals.size,
    state.agentRuns.size,
    state.policies.size,
    state.auditLog.length,
    state.auditLog.at(-1)?.id ?? "",
  ].join(":");
}

export function buildKnowledgeIndex(state: NexusState, opsDocsDir: string = defaultOpsDocsDir(), now: Date = new Date()): KnowledgeIndex {
  const builtAt = now.toISOString();
  const docs = [...recordDocs(state, builtAt), ...opsDocsFrom(opsDocsDir)];
  const postings = new Map<string, Array<{ doc: number; tf: number }>>();
  const docLengths: number[] = [];
  docs.forEach((d, i) => {
    const tokens = tokenize(`${d.title} ${d.text}`);
    docLengths.push(tokens.length);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      const list = postings.get(term) ?? [];
      list.push({ doc: i, tf: count });
      postings.set(term, list);
    }
  });
  const avgDocLength = docLengths.length ? docLengths.reduce((a, b) => a + b, 0) / docLengths.length : 0;
  return { builtAt, signature: stateSignature(state), opsDocsDir, docs, postings, docLengths, avgDocLength };
}

declare global {
  var __NEXUS_KNOWLEDGE_INDEX__: { state: NexusState; index: KnowledgeIndex } | undefined;
}

/** The process-wide index, rebuilt when the working set or its signature changed. */
export function getKnowledgeIndex(state: NexusState, opsDocsDir: string = defaultOpsDocsDir()): KnowledgeIndex {
  const cached = globalThis.__NEXUS_KNOWLEDGE_INDEX__;
  if (cached && cached.state === state && cached.index.signature === stateSignature(state) && cached.index.opsDocsDir === opsDocsDir) {
    return cached.index;
  }
  const index = buildKnowledgeIndex(state, opsDocsDir);
  globalThis.__NEXUS_KNOWLEDGE_INDEX__ = { state, index };
  return index;
}

interface Hit {
  doc: number;
  score: number;
  coverage: number;
}

export function search(index: KnowledgeIndex, question: string, opts: AskOptions = {}): Hit[] {
  const terms = Array.from(new Set(tokenize(question)));
  if (terms.length === 0) return [];
  const n = index.docs.length;
  const scores = new Map<number, { score: number; matched: Set<string> }>();
  for (const term of terms) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
    for (const { doc, tf } of list) {
      if (opts.sourceTypes && !opts.sourceTypes.includes(index.docs[doc].sourceType)) continue;
      const len = index.docLengths[doc];
      const s = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (index.avgDocLength || 1))));
      const entry = scores.get(doc) ?? { score: 0, matched: new Set<string>() };
      entry.score += s;
      entry.matched.add(term);
      scores.set(doc, entry);
    }
  }
  return Array.from(scores.entries())
    .map(([doc, { score, matched }]) => ({ doc, score, coverage: matched.size / terms.length }))
    .sort((a, b) => b.score - a.score || a.doc - b.doc);
}

function verify(index: KnowledgeIndex, state: NexusState, doc: KnowledgeDoc, opts: AskOptions): ExcludedHit | null {
  const live =
    doc.sourceType === "opsDoc"
      ? renderLiveOpsSection(index.opsDocsDir, doc.sourceId, doc.key)
      : renderLiveRecord(state, doc.sourceType, doc.sourceId);
  if (live === null) {
    return { sourceType: doc.sourceType, sourceId: doc.sourceId, reason: "MISSING", detail: "The source no longer exists." };
  }
  if (hashText(live) !== doc.hash) {
    return { sourceType: doc.sourceType, sourceId: doc.sourceId, reason: "STALE", detail: `The source changed after it was indexed at ${index.builtAt}.` };
  }
  if (opts.maxAgeHours !== undefined && doc.asOfBasis === "record") {
    const ageH = ((opts.now ?? new Date()).getTime() - Date.parse(doc.asOf)) / 3_600_000;
    if (ageH > opts.maxAgeHours) {
      return { sourceType: doc.sourceType, sourceId: doc.sourceId, reason: "TOO_OLD", detail: `Last updated ${doc.asOf}, older than ${opts.maxAgeHours} h.` };
    }
  }
  return null;
}

function idsOf(doc: KnowledgeDoc): string[] {
  return extractIds(`${doc.sourceId} ${doc.title} ${doc.text}`);
}

/**
 * Answer a question from the index. Deterministic and extractive. An id in
 * the question (e.g. SHP-2000) must exist and every passage must mention it.
 */
export function ask(index: KnowledgeIndex, state: NexusState, question: string, opts: AskOptions = {}): KnowledgeAnswer {
  const q = question.trim();
  const base = { question: q, indexBuiltAt: index.builtAt };
  if (q.length === 0) return { status: "NOT_FOUND", ...base, reason: "Empty question.", excluded: [] };

  const askedIds = extractIds(q);
  const knownIds = new Set(index.docs.filter((d) => d.sourceType !== "opsDoc").flatMap((d) => [d.sourceId.toUpperCase()]));
  const referenceCodes = new Set(
    Array.from(state.shipments.values()).map((s) => s.referenceCode.toUpperCase())
  );
  const unknown = askedIds.filter((id) => !knownIds.has(id) && !referenceCodes.has(id));
  if (unknown.length > 0) {
    return { status: "NOT_FOUND", ...base, reason: `No record found for ${unknown.join(", ")}.`, excluded: [] };
  }

  const hits = search(index, q, opts);
  const maxPassages = opts.maxPassages ?? 3;
  const excluded: ExcludedHit[] = [];
  const chosen: Array<{ doc: KnowledgeDoc; score: number }> = [];
  for (const hit of hits) {
    if (chosen.length >= maxPassages) break;
    const doc = index.docs[hit.doc];
    if (askedIds.length > 0) {
      const docIds = new Set(idsOf(doc));
      if (!askedIds.every((id) => docIds.has(id))) continue;
    } else if (hit.coverage < MIN_COVERAGE) {
      continue;
    }
    const problem = verify(index, state, doc, opts);
    if (problem) {
      excluded.push(problem);
      continue;
    }
    chosen.push({ doc, score: hit.score });
  }

  if (chosen.length === 0) {
    const reason =
      excluded.length > 0
        ? `Matching sources exist but none can be used: ${excluded.map((e) => `${e.sourceType} ${e.sourceId} is ${e.reason}`).join("; ")}.`
        : "No indexed record or ops document answers this question.";
    return { status: "NOT_FOUND", ...base, reason, excluded };
  }

  const citations: Citation[] = chosen.map(({ doc, score }, i) => ({
    n: i + 1,
    sourceType: doc.sourceType,
    sourceId: doc.sourceId,
    title: doc.title,
    asOf: doc.asOf,
    asOfBasis: doc.asOfBasis,
    score: Math.round(score * 1000) / 1000,
  }));
  const passages = chosen.map(({ doc }, i) => ({ n: i + 1, text: doc.text }));
  const answer = passages.map((p) => `${p.text} [${p.n}]`).join("\n");
  return { status: "ANSWERED", ...base, answer, passages, citations, excluded };
}
