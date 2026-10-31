import { readRoute } from "@/lib/api/handler";
import { listPolicies } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const GET = readRoute("read:policies", () => listPolicies());
