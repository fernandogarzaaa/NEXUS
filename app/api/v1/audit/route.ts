import { paginate, readRoute } from "@/lib/api/handler";
import { listAuditLog } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/audit?entityId=&action=&limit=&offset= (newest first) */
export const GET = readRoute("read:audit", ({ url }) => {
  const entityId = url.searchParams.get("entityId");
  const action = url.searchParams.get("action");
  const items = listAuditLog(Number.MAX_SAFE_INTEGER).filter(
    (a) => (!entityId || a.entityId === entityId) && (!action || a.action === action)
  );
  return paginate(items, url);
});
