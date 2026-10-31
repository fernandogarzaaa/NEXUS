import { paginate, readRoute } from "@/lib/api/handler";
import { listAgentRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/v1/agent-runs?status=&agentType=&limit=&offset= */
export const GET = readRoute("read:agent-runs", ({ url }) => {
  const status = url.searchParams.get("status");
  const agentType = url.searchParams.get("agentType");
  return paginate(listAgentRuns().filter((r) => (!status || r.status === status) && (!agentType || r.agentType === agentType)), url);
});
