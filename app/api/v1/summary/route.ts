import { readRoute } from "@/lib/api/handler";
import { getSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const GET = readRoute("read:summary", () => getSummary());
