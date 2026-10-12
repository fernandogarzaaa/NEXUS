"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-4 md:p-8">
      <div role="alert" className="panel p-6 max-w-xl">
        <h1 className="text-lg font-semibold">Something went wrong loading this view</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          The demo state may have been reset or the server restarted. Try again; if it keeps failing, reset the demo from the
          Command Center.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
