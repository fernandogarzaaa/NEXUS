import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import AutoRefresh from "@/components/AutoRefresh";
import { AgentRunStatusBadge } from "@/components/badges";
import { listAgentActivity } from "@/lib/queries";

const PHASE_COLOR: Record<string, string> = {
  DETECT: "var(--danger)",
  CONTEXT: "var(--text-muted)",
  REASON: "var(--accent)",
  PLAN: "var(--accent)",
  POLICY: "#7c3aed",
  APPROVAL: "var(--warn)",
  EXECUTE: "var(--ok)",
  VERIFY: "var(--ok)",
  UPDATE: "var(--ok)",
  AUDIT: "var(--text-muted)",
  NOTIFY: "var(--accent)",
  ESCALATE: "var(--critical)",
};

const AGENT_LABEL: Record<string, string> = {
  EXCEPTION_RECOVERY: "Exception Recovery Agent",
  DYNAMIC_DISPATCH: "Dynamic Dispatch Agent",
  COMMUNICATION: "Communication Agent",
};

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const entries = listAgentActivity(300);

  return (
    <div>
      <AutoRefresh intervalMs={4000} />
      <PageHeader
        title="Agent Activity"
        subtitle="A structured, chronological record of every agent decision — no chain-of-thought, only observable phase transitions and outcomes."
      />
      <div className="p-8">
        <div className="panel p-5">
          {entries.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
              No agent activity yet. Run the demo scenario from the Command Center.
            </p>
          ) : (
            <ol className="flex flex-col">
              {entries.map(({ step, run }, i) => (
                <li key={step.id} className="flex gap-3 py-2.5" style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}>
                  <div className="w-[70px] shrink-0 text-right font-mono text-[11px] pt-0.5" style={{ color: "var(--text-muted)" }}>
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="shrink-0 pt-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: PHASE_COLOR[step.phase] ?? "var(--text-muted)" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium">{step.label}</span>
                      <span className="badge" style={{ color: PHASE_COLOR[step.phase] ?? "var(--text-muted)", background: "transparent", border: "1px solid currentColor" }}>
                        {step.phase}
                      </span>
                      {step.status !== "OK" && (
                        <span className="badge" style={{ color: step.status === "ERROR" ? "var(--danger)" : "var(--warn)", background: step.status === "ERROR" ? "var(--danger-soft)" : "var(--warn-soft)" }}>
                          {step.status}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {step.detail}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <span>{AGENT_LABEL[run.agentType] ?? run.agentType}</span>
                      {run.shipmentId && (
                        <>
                          <span>·</span>
                          <Link href={`/shipments/${run.shipmentId}`} style={{ color: "var(--accent)" }}>
                            {run.shipmentId}
                          </Link>
                        </>
                      )}
                      <span>·</span>
                      <AgentRunStatusBadge status={run.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
