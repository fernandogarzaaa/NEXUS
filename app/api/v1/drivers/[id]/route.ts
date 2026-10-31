import { readRoute } from "@/lib/api/handler";
import { getDriver } from "@/lib/agents/tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return readRoute("read:drivers", () => getDriver(id))(request); // ToolExecutionError -> 404
}
