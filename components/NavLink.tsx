"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors"
      style={
        active
          ? { background: "var(--accent-soft)", color: "var(--accent)" }
          : { color: "var(--text-muted)" }
      }
    >
      <span className="w-4 text-center" aria-hidden="true">
        {icon}
      </span>
      {label}
    </Link>
  );
}
