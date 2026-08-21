import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { ShipmentStatusBadge, PriorityBadge } from "@/components/badges";
import { listShipments } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ShipmentsPage() {
  const shipments = listShipments();
  return (
    <div>
      <PageHeader title="Shipments" subtitle={`${shipments.length} shipments across the active demo network.`} />
      <div className="p-8">
        <div className="panel scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Customer</th>
                <th>Priority</th>
                <th>Origin → Destination</th>
                <th>Driver</th>
                <th>Status</th>
                <th>Current ETA</th>
                <th>Window Ends</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const late = new Date(s.currentEta).getTime() > new Date(s.deliveryWindowEnd).getTime();
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/shipments/${s.id}`} className="font-medium" style={{ color: "var(--accent)" }}>
                        {s.id}
                      </Link>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {s.referenceCode}
                      </div>
                    </td>
                    <td>{s.customerName}</td>
                    <td>
                      <PriorityBadge priority={s.priority} />
                    </td>
                    <td className="text-[13px]">
                      {s.originFacilityId} → {s.destinationFacilityId}
                    </td>
                    <td>{s.driverId ?? "—"}</td>
                    <td>
                      <ShipmentStatusBadge status={s.status} />
                    </td>
                    <td className="text-[13px]" style={late ? { color: "var(--danger)" } : undefined}>
                      {new Date(s.currentEta).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                      {new Date(s.deliveryWindowEnd).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
