import { paginate, readRoute } from "@/lib/api/handler";
import { listApprovals } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/approvals?status=&limit=&offset= */
export const GET = readRoute("read:approvals", ({ url }) => {
  const status = url.searchParams.get("status");
  return paginate(listApprovals().filter((a) => !status || a.status === status), url);
});
