"use client";

import { useState, useTransition } from "react";
import { updatePolicyAction } from "@/lib/actions";
import type { AutonomyLevel, Policy } from "@/lib/domain/types";
import { AutonomyBadge } from "@/components/badges";

const LEVELS: AutonomyLevel[] = ["OBSERVE", "RECOMMEND", "LOW_RISK_AUTONOMOUS", "OPERATIONAL_AUTONOMOUS", "HIGH_IMPACT_APPROVAL"];

export default function PolicyRow({ policy }: { policy: Policy }) {
  const [level, setLevel] = useState<AutonomyLevel>(policy.autonomyLevel);
  const [maxCost, setMaxCost] = useState<string>(policy.maxCostUsd === null ? "" : String(policy.maxCostUsd));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    const parsed = maxCost.trim() === "" ? null : Number(maxCost);
    startTransition(async () => {
      await updatePolicyAction(policy.actionType, level, parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <tr>
      <td>
        <div className="font-medium text-[13px]">{policy.label}</div>
        <div className="text-[12px] max-w-[320px]" style={{ color: "var(--text-muted)" }}>
          {policy.description}
        </div>
      </td>
      <td>
        <AutonomyBadge level={policy.autonomyLevel} />
      </td>
      <td>
        {policy.editable ? (
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as AutonomyLevel)}
            className="rounded-md border px-2 py-1 text-[12.5px]"
            style={{ borderColor: "var(--border)" }}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>fixed</span>
        )}
      </td>
      <td>
        {policy.editable ? (
          <input
            type="number"
            min={0}
            value={maxCost}
            onChange={(e) => setMaxCost(e.target.value)}
            placeholder="no limit"
            className="w-24 rounded-md border px-2 py-1 text-[12.5px]"
            style={{ borderColor: "var(--border)" }}
          />
        ) : (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </td>
      <td>
        {policy.editable && (
          <button
            onClick={save}
            disabled={pending}
            className="rounded-md border px-3 py-1 text-[12.5px] font-medium disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            {saved ? "Saved ✓" : pending ? "Saving…" : "Save"}
          </button>
        )}
      </td>
    </tr>
  );
}
