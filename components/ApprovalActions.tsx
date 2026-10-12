"use client";

import { useState, useTransition } from "react";
import { decideApprovalAction } from "@/lib/actions";

export default function ApprovalActions({ approvalId }: { approvalId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await decideApprovalAction(approvalId, approve);
      } catch {
        setError("Could not record the decision. Your session may have expired; reload and try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => decide(true)}
          className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: "var(--ok)" }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => decide(false)}
          className="rounded-lg border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          Reject
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12px]" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
