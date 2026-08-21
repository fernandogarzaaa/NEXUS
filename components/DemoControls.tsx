"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { runHeroDemoAction, simulateRandomEventAction, runDispatchSweepAction, resetDemoAction } from "@/lib/actions";

type ActionKey = "dispatch" | "simulate" | "reset" | "demo";

const LABELS: Record<ActionKey, string> = {
  dispatch: "Run Dispatch Sweep",
  simulate: "Simulate Random Event",
  reset: "Reset Demo",
  demo: "▶ Run Demo Scenario",
};

function Button({
  onClick,
  disabled,
  busy,
  variant = "default",
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  variant?: "default" | "primary" | "ghost";
  children: React.ReactNode;
}) {
  const styles: React.CSSProperties =
    variant === "primary"
      ? { background: "var(--accent)", color: "white", borderColor: "var(--accent)" }
      : variant === "ghost"
        ? { background: "transparent", color: "var(--text-muted)", borderColor: "var(--border)" }
        : { background: "var(--bg-panel)", color: "var(--text)", borderColor: "var(--border)" };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className="rounded-lg border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-60 transition-opacity inline-flex items-center gap-1.5"
      style={styles}
    >
      {busy && (
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-full border-2 animate-spin"
          style={{ borderColor: "currentColor", borderTopColor: "transparent" }}
        />
      )}
      {busy ? "Working…" : children}
    </button>
  );
}

export default function DemoControls() {
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [justCompleted, setJustCompleted] = useState<ActionKey | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function run(key: ActionKey, action: () => Promise<void>) {
    setActiveAction(key);
    setJustCompleted(null);
    startTransition(async () => {
      await action();
      setActiveAction(null);
      setJustCompleted(key);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setJustCompleted(null), 3000);
    });
  }

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  return (
    <div className="flex items-center gap-2">
      {justCompleted && !pending && (
        <span
          role="status"
          className="text-[12px] font-medium flex items-center gap-1"
          style={{ color: "var(--ok)" }}
        >
          ✓ {LABELS[justCompleted]} complete
        </span>
      )}
      <Button
        variant="ghost"
        disabled={pending}
        busy={activeAction === "dispatch"}
        onClick={() => run("dispatch", runDispatchSweepAction)}
      >
        {LABELS.dispatch}
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        busy={activeAction === "simulate"}
        onClick={() => run("simulate", simulateRandomEventAction)}
      >
        {LABELS.simulate}
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        busy={activeAction === "reset"}
        onClick={() => {
          if (confirm("Reset the demo to a fresh seeded state? This clears all agent runs, exceptions, and audit history.")) {
            run("reset", resetDemoAction);
          }
        }}
      >
        {LABELS.reset}
      </Button>
      <Button variant="primary" disabled={pending} busy={activeAction === "demo"} onClick={() => run("demo", runHeroDemoAction)}>
        {LABELS.demo}
      </Button>
    </div>
  );
}
