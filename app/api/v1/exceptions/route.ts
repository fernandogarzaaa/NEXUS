import { paginate, readRoute } from "@/lib/api/handler";
import { listExceptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/exceptions?status=&severity=&limit=&offset= */
export const GET = readRoute("read:exceptions", ({ url }) => {
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const items = listExceptions().filter((e) => (!status || e.status === status) && (!severity || e.severity === severity));
  return paginate(items, url);
});
