import { paginate, readRoute } from "@/lib/api/handler";
import { listVehicles } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const GET = readRoute("read:vehicles", ({ url }) => paginate(listVehicles(), url));
