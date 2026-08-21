"use client";

import { useTransition } from "react";
import { decideApprovalAction } from "@/lib/actions";

export default function ApprovalActions({ approvalId }: { approvalId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => startTransition(() => decideApprovalAction(approvalId, true))}
        className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        style={{ background: "var(--ok)" }}
      >
        Approve
      </button>
      <button
        disabled={pending}
        onClick={() => startTransition(() => decideApprovalAction(approvalId, false))}
        className="rounded-lg border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50"
        style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
      >
        Reject
      </button>
    </div>
  );
}
