import { paginate, readRoute } from "@/lib/api/handler";
import { listShipments } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/shipments?status=&priority=&driverId=&limit=&offset= */
export const GET = readRoute("read:shipments", ({ url }) => {
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const driverId = url.searchParams.get("driverId");
  const items = listShipments().filter(
    (s) => (!status || s.status === status) && (!priority || s.priority === priority) && (!driverId || s.driverId === driverId)
  );
  return paginate(items, url);
});
