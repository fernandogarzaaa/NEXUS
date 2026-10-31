import { ApiError, readRoute } from "@/lib/api/handler";
import { getShipmentDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return readRoute("read:shipments", () => {
    const detail = getShipmentDetail(id);
    if (!detail) throw new ApiError(404, "not_found", `Unknown shipment ${id}`);
    return detail;
  })(request);
}
