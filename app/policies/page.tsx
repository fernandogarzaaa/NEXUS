import PageHeader from "@/components/PageHeader";
import PolicyRow from "@/components/PolicyRow";
import { listPolicies } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function PoliciesPage() {
  const policies = listPolicies();

  return (
    <div>
      <PageHeader
        title="Policy Configuration"
        subtitle="Configurable autonomy per action type — this is what makes NEXUS controlled autonomy, not unrestricted AI execution."
      />
      <div className="p-8 flex flex-col gap-6">
        <div className="panel scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Action Type</th>
                <th>Current Level</th>
                <th>Edit Level</th>
                <th>Max Autonomous Cost (USD)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <PolicyRow key={p.actionType} policy={p} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel p-5">
          <h2 className="font-semibold text-sm mb-3">Autonomy Levels</h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
            <div>
              <dt className="font-medium">Observe</dt>
              <dd style={{ color: "var(--text-muted)" }}>Agent detects and reports only; takes no action.</dd>
            </div>
            <div>
              <dt className="font-medium">Recommend</dt>
              <dd style={{ color: "var(--text-muted)" }}>Agent proposes an action but always requires approval.</dd>
            </div>
            <div>
              <dt className="font-medium">Low-risk Autonomous</dt>
              <dd style={{ color: "var(--text-muted)" }}>Agent executes predefined low-risk actions under a cost threshold.</dd>
            </div>
            <div>
              <dt className="font-medium">Operational Autonomous</dt>
              <dd style={{ color: "var(--text-muted)" }}>Agent executes permitted operational actions within configured limits.</dd>
            </div>
            <div>
              <dt className="font-medium">High-impact</dt>
              <dd style={{ color: "var(--text-muted)" }}>Always requires human approval, regardless of cost.</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
