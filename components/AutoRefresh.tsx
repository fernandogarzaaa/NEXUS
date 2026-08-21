"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls the server and re-renders server components on an interval — keeps
 * live pages (Command Center, Agent Activity) feeling current without a
 * websocket layer, which is unnecessary for a single-operator POC. */
export default function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
