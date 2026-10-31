import { ApiError, readRoute } from "@/lib/api/handler";
import { askKnowledge, isKnowledgeSourceType } from "@/lib/knowledge/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/ask?q=...&maxAgeHours=&types=shipment,exception
 * Cited, extractive answers over canonical records and ops docs. Returns
 * status NOT_FOUND (HTTP 200) when no fresh, relevant source exists.
 */
export const GET = readRoute("read:knowledge", ({ url }) => {
  const q = url.searchParams.get("q") ?? "";
  if (q.trim().length === 0) throw new ApiError(400, "bad_request", "Query parameter q is required.");
  if (q.length > 500) throw new ApiError(400, "bad_request", "Query parameter q is limited to 500 characters.");
  const maxAgeRaw = url.searchParams.get("maxAgeHours");
  const maxAgeHours = maxAgeRaw === null ? undefined : Number(maxAgeRaw);
  if (maxAgeHours !== undefined && !(Number.isFinite(maxAgeHours) && maxAgeHours > 0)) {
    throw new ApiError(400, "bad_request", "maxAgeHours must be a positive number.");
  }
  const typesRaw = url.searchParams.get("types");
  const sourceTypes = typesRaw ? typesRaw.split(",").map((t) => t.trim()) : undefined;
  const unknown = (sourceTypes ?? []).filter((t) => !isKnowledgeSourceType(t));
  if (unknown.length) throw new ApiError(400, "bad_request", `Unknown source type(s): ${unknown.join(", ")}`);
  return askKnowledge(q, { maxAgeHours, sourceTypes });
});
