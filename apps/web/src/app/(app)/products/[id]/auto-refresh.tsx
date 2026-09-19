"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls persisted run state while a discovery run is active; no simulated progress. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(t);
  }, [active, router]);
  return null;
}
