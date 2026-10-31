import { getState } from "../domain/store";
import { ask, getKnowledgeIndex, type AskOptions, type KnowledgeAnswer } from "./index";
import { RECORD_SOURCE_TYPES, type KnowledgeSourceType } from "./sources";

// Entry point used by the API route and the MCP tool. Reads the working set
// through the store facade (callers hydrate it first) and never mutates it.

const ALL_TYPES: KnowledgeSourceType[] = [...RECORD_SOURCE_TYPES, "opsDoc"];

export function isKnowledgeSourceType(t: string): t is KnowledgeSourceType {
  return (ALL_TYPES as string[]).includes(t);
}

export function askKnowledge(
  question: string,
  opts: Omit<AskOptions, "sourceTypes"> & { sourceTypes?: string[] } = {}
): KnowledgeAnswer {
  const envMax = Number(process.env.NEXUS_RAG_MAX_AGE_HOURS);
  const maxAgeHours = opts.maxAgeHours ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : undefined);
  const unknown = (opts.sourceTypes ?? []).filter((t) => !isKnowledgeSourceType(t));
  if (unknown.length) throw new Error(`Unknown source type(s): ${unknown.join(", ")}`);
  const state = getState();
  return ask(getKnowledgeIndex(state), state, question, {
    ...opts,
    maxAgeHours,
    sourceTypes: opts.sourceTypes as KnowledgeSourceType[] | undefined,
  });
}
