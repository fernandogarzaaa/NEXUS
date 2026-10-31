import { paginate, readRoute } from "@/lib/api/handler";
import { listFacilities } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const GET = readRoute("read:facilities", ({ url }) => paginate(listFacilities(), url));
