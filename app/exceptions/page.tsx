import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AutoRefresh from "@/components/AutoRefresh";
import { SeverityBadge, ExceptionStatusBadge, AgentRunStatusBadge, AutonomyBadge } from "@/components/badges";
import { listExceptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ExceptionsPage() {
  const exceptions = listExceptions();

  return (
    <div>
      <AutoRefresh intervalMs={5000} />
      <PageHeader title="Exception Queue" subtitle="Every operational exception detected by NEXUS, its recommended recovery, and current status." />
      <div className="p-8">
        <div className="panel scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Exception</th>
                <th>Severity</th>
                <th>ETA Impact</th>
                <th>Recommendation</th>
                <th>Autonomy</th>
                <th>Status</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10" style={{ color: "var(--text-muted)" }}>
                    No exceptions yet — run the demo scenario from the Command Center to generate one.
                  </td>
                </tr>
              )}
              {exceptions.map((e) => {
                const plan = e.latestRun?.plan;
                const selected = plan?.options.find((o) => o.id === plan.selectedOptionId);
                return (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/shipments/${e.shipmentId}`} className="font-medium" style={{ color: "var(--accent)" }}>
                        {e.shipmentId}
                      </Link>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {e.shipment?.customerName}
                      </div>
                    </td>
                    <td>
                      <div>{e.type.replace(/_/g, " ")}</div>
                      <div className="text-[11px] max-w-[260px]" style={{ color: "var(--text-muted)" }}>
                        {e.description}
                      </div>
                    </td>
                    <td>
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td>{e.etaImpactMin} min</td>
                    <td className="max-w-[240px]">
                      {selected ? (
                        <span className="text-[13px]">{selected.type.replace(/_/g, " ")}</span>
                      ) : e.latestRun ? (
                        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                          evaluating…
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td>{e.latestRun?.autonomyLevel ? <AutonomyBadge level={e.latestRun.autonomyLevel} /> : "—"}</td>
                    <td>
                      <ExceptionStatusBadge status={e.status} />
                    </td>
                    <td>{e.latestRun ? <AgentRunStatusBadge status={e.latestRun.status} /> : "—"}</td>
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
