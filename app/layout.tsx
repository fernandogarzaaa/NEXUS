import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getSummary } from "@/lib/queries";
import NavLink from "@/components/NavLink";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NEXUS — Agentic Logistics Operations",
  description: "AI-first agentic logistics operations platform proof-of-concept",
};

const NAV = [
  { href: "/", label: "Command Center", icon: "◈" },
  { href: "/exceptions", label: "Exception Queue", icon: "⚠" },
  { href: "/shipments", label: "Shipments", icon: "▤" },
  { href: "/activity", label: "Agent Activity", icon: "≡" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/policies", label: "Policy Config", icon: "⚙" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const summary = getSummary();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex text-[15px]">
        <aside className="w-60 shrink-0 border-r flex flex-col" style={{ borderColor: "var(--border)", background: "var(--bg-panel)" }}>
          <div className="px-5 py-5 border-b" style={{ borderColor: "var(--border)" }}>
            <Link href="/" className="flex items-center gap-2" aria-label="NEXUS — Agentic Logistics, go to Command Center">
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white font-bold text-sm"
                style={{ background: "var(--accent)" }}
              >
                N
              </span>
              <div className="leading-tight" aria-hidden="true">
                <div className="font-semibold tracking-tight">NEXUS</div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Agentic Logistics
                </div>
              </div>
            </Link>
          </div>
          <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
            ))}
          </nav>
          <div className="px-4 py-4 border-t text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            {summary.pendingApprovals > 0 ? (
              <Link href="/approvals" className="flex items-center gap-1.5 font-medium" style={{ color: "var(--warn)" }}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--warn)" }} />
                {summary.pendingApprovals} pending approval{summary.pendingApprovals === 1 ? "" : "s"}
              </Link>
            ) : (
              <span>All clear — no pending approvals</span>
            )}
            <div className="mt-1">Seed #{summary.seed}</div>
          </div>
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </body>
    </html>
  );
}
