import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DemoControls from "@/components/DemoControls";
import AutoRefresh from "@/components/AutoRefresh";
import OpsMap from "@/components/OpsMap";
import { SeverityBadge, ExceptionStatusBadge, AgentRunStatusBadge } from "@/components/badges";
import { getSummary, listExceptions, listFacilities, listShipments, listAgentActivity } from "@/lib/queries";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--text)";
  return (
    <div className="panel px-5 py-4">
      <div className="text-[11px] uppercase tracking-wide font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="kpi-value text-2xl font-semibold mt-1" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default function CommandCenterPage() {
  const summary = getSummary();
  const exceptions = listExceptions().slice(0, 6);
  const facilities = listFacilities();
  const shipments = listShipments();
  const activity = listAgentActivity(8);

  return (
    <div>
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Operations Command Center"
        subtitle="Live view of the NEXUS agentic operations layer — observe, decide, act, verify, escalate."
        actions={<DemoControls />}
      />
      <div className="p-8 flex flex-col gap-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Kpi label="Total Shipments" value={String(summary.totalShipments)} />
          <Kpi label="Active Shipments" value={String(summary.activeShipments)} />
          <Kpi label="On-Time Rate" value={`${(summary.onTimeRate * 100).toFixed(0)}%`} tone={summary.onTimeRate < 0.9 ? "warn" : "ok"} />
          <Kpi label="Active Exceptions" value={String(summary.activeExceptions)} tone={summary.activeExceptions > 0 ? "warn" : "ok"} />
          <Kpi label="Critical Exceptions" value={String(summary.criticalExceptions)} tone={summary.criticalExceptions > 0 ? "danger" : "ok"} />
          <Kpi label="Autonomous Actions" value={String(summary.autonomousActions)} />
          <Kpi label="Pending Approvals" value={String(summary.pendingApprovals)} tone={summary.pendingApprovals > 0 ? "warn" : "ok"} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Operational Route Map</h2>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {facilities.length} facilities · {shipments.filter((s) => s.status === "IN_TRANSIT").length} in transit
              </span>
            </div>
            <OpsMap facilities={facilities} shipments={shipments} />
            <div className="flex items-center gap-4 mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5" style={{ background: "var(--accent)" }} /> In transit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5" style={{ background: "var(--danger)" }} /> Active exception
              </span>
            </div>
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Recent Agent Activity</h2>
              <Link href="/activity" className="text-[12px] font-medium" style={{ color: "var(--accent)" }}>
                View timeline →
              </Link>
            </div>
            <ul className="flex flex-col gap-3">
              {activity.length === 0 && (
                <li className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No agent activity yet. Run the demo scenario to see NEXUS in action.
                </li>
              )}
              {activity.map(({ step, run }) => (
                <li key={step.id} className="text-[13px] flex gap-2">
                  <span className="shrink-0 font-mono text-[11px] pt-0.5" style={{ color: "var(--text-muted)" }}>
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </span>
                  <div>
                    <div className="font-medium">{step.label}</div>
                    <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {run.agentType.replace(/_/g, " ")} · {run.shipmentId}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel">
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold text-sm">Active Exceptions</h2>
            <Link href="/exceptions" className="text-[12px] font-medium" style={{ color: "var(--accent)" }}>
              View exception queue →
            </Link>
          </div>
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>ETA Impact</th>
                  <th>Status</th>
                  <th>Latest Run</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6" style={{ color: "var(--text-muted)" }}>
                      No exceptions recorded yet.
                    </td>
                  </tr>
                )}
                {exceptions.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/shipments/${e.shipmentId}`} className="font-medium" style={{ color: "var(--accent)" }}>
                        {e.shipmentId}
                      </Link>
                    </td>
                    <td>{e.type.replace(/_/g, " ")}</td>
                    <td>
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td>{e.etaImpactMin} min</td>
                    <td>
                      <ExceptionStatusBadge status={e.status} />
                    </td>
                    <td>{e.latestRun ? <AgentRunStatusBadge status={e.latestRun.status} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
