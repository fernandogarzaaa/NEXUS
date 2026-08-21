import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AutoRefresh from "@/components/AutoRefresh";
import { ApprovalStatusBadge } from "@/components/badges";
import ApprovalActions from "@/components/ApprovalActions";
import { listApprovals } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const approvals = listApprovals();
  const pending = approvals.filter((a) => a.status === "PENDING");
  const resolved = approvals.filter((a) => a.status !== "PENDING");

  return (
    <div>
      <AutoRefresh intervalMs={5000} />
      <PageHeader
        title="Approval Queue"
        subtitle="High-impact or over-threshold agent actions wait here for a human decision before executing."
      />
      <div className="p-8 flex flex-col gap-6">
        <div>
          <h2 className="font-semibold text-sm mb-3">Pending ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="text-sm panel px-5 py-6" style={{ color: "var(--text-muted)" }}>
              No approvals waiting — every action currently in flight is either autonomous or already resolved.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {pending.map((a) => (
                <div key={a.id} className="panel p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/shipments/${a.shipmentId}`} className="font-semibold text-[14px]" style={{ color: "var(--accent)" }}>
                          {a.shipmentId}
                        </Link>
                        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                          {a.actionType.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-[13px] font-medium">{a.summary}</p>
                    </div>
                    <ApprovalActions approvalId={a.id} />
                  </div>
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t text-[13px]" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <dt className="text-[11px] uppercase font-medium" style={{ color: "var(--text-muted)" }}>
                        What will happen
                      </dt>
                      <dd>{a.whatWillHappen}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase font-medium" style={{ color: "var(--text-muted)" }}>
                        Why
                      </dt>
                      <dd>{a.why}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase font-medium" style={{ color: "var(--text-muted)" }}>
                        Expected impact
                      </dt>
                      <dd>{a.expectedImpact}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase font-medium" style={{ color: "var(--text-muted)" }}>
                        Cost · SLA · Confidence
                      </dt>
                      <dd>
                        ${a.estimatedCostUsd.toFixed(0)} · {a.slaImpactMin} min · {(a.confidence * 100).toFixed(0)}%
                      </dd>
                    </div>
                  </dl>
                  {a.contextNotes.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {a.contextNotes.map((n, i) => (
                        <li key={i} className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-panel-alt)" }}>
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="font-semibold text-sm mb-3">Resolved ({resolved.length})</h2>
          <div className="panel scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Resolved By</th>
                  <th>Resolved At</th>
                </tr>
              </thead>
              <tbody>
                {resolved.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6" style={{ color: "var(--text-muted)" }}>
                      No resolved approvals yet.
                    </td>
                  </tr>
                )}
                {resolved.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/shipments/${a.shipmentId}`} style={{ color: "var(--accent)" }}>
                        {a.shipmentId}
                      </Link>
                    </td>
                    <td>{a.actionType.replace(/_/g, " ")}</td>
                    <td>
                      <ApprovalStatusBadge status={a.status} />
                    </td>
                    <td>{a.resolvedBy ?? "—"}</td>
                    <td className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                      {a.resolvedAt ? new Date(a.resolvedAt).toLocaleString() : "—"}
                    </td>
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
