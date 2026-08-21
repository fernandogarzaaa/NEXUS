"use client";

import { useState, useTransition } from "react";
import { runHeroDemoAction, simulateRandomEventAction, runDispatchSweepAction, resetDemoAction } from "@/lib/actions";

function Button({
  onClick,
  pending,
  variant = "default",
  children,
}: {
  onClick: () => void;
  pending: boolean;
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
      disabled={pending}
      className="rounded-lg border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50 transition-opacity"
      style={styles}
    >
      {children}
    </button>
  );
}

export default function DemoControls() {
  const [pending, startTransition] = useTransition();
  const [lastAction, setLastAction] = useState<string | null>(null);

  function run(label: string, action: () => Promise<void>) {
    setLastAction(label);
    startTransition(async () => {
      await action();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {pending && (
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Running {lastAction}…
        </span>
      )}
      <Button variant="ghost" pending={pending} onClick={() => run("dispatch sweep", runDispatchSweepAction)}>
        Run Dispatch Sweep
      </Button>
      <Button variant="ghost" pending={pending} onClick={() => run("random event", simulateRandomEventAction)}>
        Simulate Random Event
      </Button>
      <Button
        variant="ghost"
        pending={pending}
        onClick={() => {
          if (confirm("Reset the demo to a fresh seeded state? This clears all agent runs, exceptions, and audit history.")) {
            run("reset", resetDemoAction);
          }
        }}
      >
        Reset Demo
      </Button>
      <Button variant="primary" pending={pending} onClick={() => run("hero demo", runHeroDemoAction)}>
        ▶ Run Demo Scenario
      </Button>
    </div>
  );
}
