import { authenticateApiRequest, type ApiAuthEnv, type ApiPrincipal, type ApiScope } from "../apiAuth";
import { loadState, persistState, getRepository } from "../domain/store";
import { recordApiAccess, ToolExecutionError } from "../agents/tools";

// ---------------------------------------------------------------------------
// Wrapper for every public API route. Order of operations is fixed:
// authenticate + authorise the scope -> hydrate the working set -> run the
// read (queries/tools only) -> write the access audit event through the tool
// layer -> persist -> respond. Route files never touch the store directly.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiContext {
  principal: ApiPrincipal;
  request: Request;
  url: URL;
  requestId: string;
}

export type ApiReadHandler<T> = (ctx: ApiContext) => T | Promise<T>;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  if (supplied && /^[A-Za-z0-9_.:-]{1,128}$/.test(supplied)) return supplied;
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorResponse(status: number, code: string, message: string, requestId: string): Response {
  return new Response(JSON.stringify({ error: { code, message }, meta: { requestId } }), {
    status,
    headers: { ...JSON_HEADERS, "x-request-id": requestId, ...(status === 401 ? { "www-authenticate": "Bearer" } : {}) },
  });
}

export function readLimit(url: URL, fallback = 100, max = 500): { limit: number; offset: number } {
  const limitRaw = Number(url.searchParams.get("limit") ?? fallback);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, max) : fallback;
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  return { limit, offset };
}

export function paginate<T>(items: T[], url: URL, fallback = 100): { items: T[]; page: { limit: number; offset: number; total: number } } {
  const { limit, offset } = readLimit(url, fallback);
  return { items: items.slice(offset, offset + limit), page: { limit, offset, total: items.length } };
}

/** Build a GET route handler that is authenticated, scoped, audited and read-only. */
export function readRoute<T>(scope: ApiScope, handler: ApiReadHandler<T>) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdFor(request);
    const url = new URL(request.url);
    const auth = authenticateApiRequest(process.env as ApiAuthEnv, request.headers.get("authorization"), scope);

    if (!auth.ok) {
      // A recognised key that is refused (tenant/scope) is audited; anonymous
      // or invalid attempts are not persisted so they cannot flood the log.
      if (auth.keyId) {
        await loadState();
        recordApiAccess({
          keyId: auth.keyId,
          subject: "unknown",
          tenantId: "n/a",
          method: request.method,
          path: url.pathname,
          scope,
          outcome: "DENIED",
          status: auth.status,
          requestId,
        });
        await persistState();
      }
      return errorResponse(auth.status, auth.code, auth.message, requestId);
    }

    try {
      await loadState();
      const data = await handler({ principal: auth.principal, request, url, requestId });
      recordApiAccess({
        keyId: auth.principal.keyId,
        subject: auth.principal.subject,
        tenantId: auth.principal.tenantId,
        method: request.method,
        path: url.pathname,
        scope,
        outcome: "ALLOWED",
        status: 200,
        requestId,
      });
      await persistState();
      const body = JSON.stringify({
        data,
        meta: { requestId, tenantId: auth.principal.tenantId, backend: getRepository().backend, generatedAt: new Date().toISOString() },
      });
      return new Response(body, { status: 200, headers: { ...JSON_HEADERS, "x-request-id": requestId } });
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message, requestId);
      if (err instanceof ToolExecutionError) return errorResponse(404, "not_found", err.message, requestId);
      const message = err instanceof Error ? err.message : "Unexpected error";
      return errorResponse(500, "internal_error", message, requestId);
    }
  };
}
