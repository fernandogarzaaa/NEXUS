import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import AutoRefresh from "@/components/AutoRefresh";
import {
  ShipmentStatusBadge,
  PriorityBadge,
  SeverityBadge,
  ExceptionStatusBadge,
  AgentRunStatusBadge,
  AutonomyBadge,
} from "@/components/badges";
import { getShipmentDetail } from "@/lib/queries";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-[14px] mt-0.5">{value}</div>
    </div>
  );
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const dynamic = "force-dynamic";

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getShipmentDetail(id);
  if (!detail) notFound();

  const { shipment, driver, vehicle, route, originFacility, destinationFacility, exceptions, agentRuns, communications, auditEvents } = detail;

  return (
    <div>
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title={`${shipment.id} — ${shipment.referenceCode}`}
        subtitle={`${shipment.customerName} · ${originFacility?.name ?? shipment.originFacilityId} → ${destinationFacility?.name ?? shipment.destinationFacilityId}`}
        actions={
          <>
            <PriorityBadge priority={shipment.priority} />
            <ShipmentStatusBadge status={shipment.status} />
          </>
        }
      />
      <div className="p-8 flex flex-col gap-6">
        <div className="panel p-5 grid grid-cols-2 md:grid-cols-4 gap-5">
          <Field label="Driver" value={driver ? `${driver.name} (${driver.id})` : "Unassigned"} />
          <Field label="Vehicle" value={vehicle ? `${vehicle.type.replace(/_/g, " ")} — ${vehicle.id}` : "—"} />
          <Field label="Distance" value={`${shipment.distanceMiles} mi`} />
          <Field label="Weight" value={`${shipment.weightLbs.toLocaleString()} lbs`} />
          <Field label="Scheduled ETA" value={fmt(shipment.scheduledEta)} />
          <Field
            label="Current ETA"
            value={
              <span style={new Date(shipment.currentEta) > new Date(shipment.deliveryWindowEnd) ? { color: "var(--danger)" } : undefined}>
                {fmt(shipment.currentEta)}
              </span>
            }
          />
          <Field label="Delivery Window" value={`${fmt(shipment.deliveryWindowStart)} – ${fmt(shipment.deliveryWindowEnd)}`} />
          <Field
            label="Appointment"
            value={
              shipment.appointment
                ? `${fmt(shipment.appointment.start)} at ${shipment.appointment.facilityId} (${shipment.appointment.status})`
                : "No facility appointment"
            }
          />
          {route && (
            <>
              <Field label="Route" value={route.id} />
              <Field label="Traffic Factor" value={`${route.trafficFactor.toFixed(2)}x`} />
            </>
          )}
        </div>

        <div className="panel">
          <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold text-sm">Exceptions ({exceptions.length})</h2>
          </div>
          {exceptions.length === 0 ? (
            <div className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
              No exceptions recorded for this shipment.
            </div>
          ) : (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>ETA Impact</th>
                    <th>Status</th>
                    <th>Resolution</th>
                    <th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((e) => (
                    <tr key={e.id}>
                      <td>{e.type.replace(/_/g, " ")}</td>
                      <td>
                        <SeverityBadge severity={e.severity} />
                      </td>
                      <td>{e.etaImpactMin} min</td>
                      <td>
                        <ExceptionStatusBadge status={e.status} />
                      </td>
                      <td className="max-w-[280px] text-[13px]">{e.resolutionSummary ?? "—"}</td>
                      <td className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                        {fmt(e.detectedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold text-sm">Agent Actions ({agentRuns.length} run{agentRuns.length === 1 ? "" : "s"})</h2>
          </div>
          {agentRuns.length === 0 ? (
            <div className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
              No agent runs yet for this shipment.
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {agentRuns.map((run) => (
                <div key={run.id} className="px-5 py-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[13px]">{run.agentType.replace(/_/g, " ")}</span>
                      <AgentRunStatusBadge status={run.status} />
                      {run.autonomyLevel && <AutonomyBadge level={run.autonomyLevel} />}
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {fmt(run.startedAt)}
                      {run.completedAt ? ` – ${fmt(run.completedAt)}` : " (in progress)"}
                    </span>
                  </div>
                  {run.outcomeSummary && (
                    <p className="text-[13px] mb-2" style={{ color: "var(--text-muted)" }}>
                      {run.outcomeSummary}
                    </p>
                  )}
                  <ol className="flex flex-col gap-1.5 border-l pl-4" style={{ borderColor: "var(--border)" }}>
                    {run.steps.map((step) => (
                      <li key={step.id} className="text-[12.5px]">
                        <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {new Date(step.timestamp).toLocaleTimeString()}
                        </span>{" "}
                        <span className="font-medium">{step.label}</span>
                        <span style={{ color: "var(--text-muted)" }}> — {step.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="panel">
            <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="font-semibold text-sm">Communication History</h2>
            </div>
            {communications.length === 0 ? (
              <div className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
                No communications yet.
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {communications.map((c) => (
                  <li key={c.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold" style={{ color: "var(--accent)" }}>
                        {c.channel} → {c.recipient}
                      </span>
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {fmt(c.sentAt)}
                      </span>
                    </div>
                    <div className="text-[13px] font-medium mt-0.5">{c.subject}</div>
                    <div className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                      {c.body}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="font-semibold text-sm">Audit History</h2>
            </div>
            {auditEvents.length === 0 ? (
              <div className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
                No audit events yet.
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {auditEvents.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold">{a.action.replace(/_/g, " ")}</span>
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {fmt(a.timestamp)}
                      </span>
                    </div>
                    <div className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                      {a.actorType} ({a.actorId}) — {a.detail}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <Link href="/shipments" className="text-[13px] font-medium" style={{ color: "var(--accent)" }}>
          ← Back to shipments
        </Link>
      </div>
    </div>
  );
}
