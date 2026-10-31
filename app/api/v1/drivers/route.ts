import { paginate, readRoute } from "@/lib/api/handler";
import { listDrivers } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/drivers?status=&limit=&offset= */
export const GET = readRoute("read:drivers", ({ url }) => {
  const status = url.searchParams.get("status");
  const items = listDrivers()
    .filter((d) => !status || d.status === status)
    .sort((a, b) => a.id.localeCompare(b.id));
  return paginate(items, url);
});
