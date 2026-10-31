# Knowledge retrieval (RAG)

`lib/knowledge/` answers questions from **canonical records** (shipments,
drivers, vehicles, facilities, exceptions, approvals, agent runs, policies)
and **supplied ops documents** (`docs/ops/`, or `NEXUS_OPS_DOCS_DIR`).

## Rules it enforces

- **Every answer cites its source.** Each sentence of an answer is a
  retrieved passage followed by `[n]`; citation `n` names the source type,
  source id, title and `asOf` timestamp. `asOfBasis` says what the timestamp
  is: the record's own `updatedAt`/`detectedAt`/`resolvedAt`/`createdAt`
  (`record`), the index snapshot time for records that carry no timestamp
  such as drivers and policies (`snapshot`), or the ops file's modification
  time (`file`).
- **Missing data is NOT_FOUND, not a guess.** An id in the question
  (`SHP-…`, `D-…`, `FAC-…`, a reference code …) must exist, and every
  passage used must mention it. Without an id, a passage must contain at
  least half of the question's content terms.
- **Stale data is NOT_FOUND, not a guess.** Before a passage is used it is
  re-rendered from the live working set (or re-read from disk) and its
  SHA-256 compared with the indexed one. A changed source is `STALE`, a
  deleted one `MISSING`; both are excluded and listed in `excluded`. With
  `maxAgeHours` (or `NEXUS_RAG_MAX_AGE_HOURS`), records whose own timestamp
  is older are excluded as `TOO_OLD`.
- **Deterministic and offline.** BM25 over an in-process index; no
  embedding service and no LLM. Answers are extractive. The index is
  rebuilt when the working set's signature (entity counts + latest audit
  event) changes, and the hash check covers anything the signature misses.

## Where it is exposed

- `GET /api/v1/ask?q=…[&maxAgeHours=…][&types=shipment,opsDoc]`, scope
  `read:knowledge` (see `api.md`).
- The `ask_knowledge` MCP tool (see `mcp.md`).

Both return `{ status: "ANSWERED", answer, passages, citations, excluded }`
or `{ status: "NOT_FOUND", reason, excluded }`.

## Not built

- Semantic (embedding) retrieval. Lexical BM25 is enough for ids, names and
  statuses; an embedding retriever would slot in behind `search()` and keep
  the same verification and citation rules.
- Senor Tech ops documents: none were supplied. `docs/ops/exception-handling.md`
  restates NEXUS's own behaviour from the code and is labelled as such.
