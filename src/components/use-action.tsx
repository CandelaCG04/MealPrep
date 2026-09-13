"use client";

import { useState, useTransition } from "react";

/** FormData from a plain object, for calling form-style server actions from event handlers. */
export function fd(fields: Record<string, string | number | null | undefined>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v === null || v === undefined ? "" : String(v));
  return data;
}

/** Runs a server action in a transition; a failure sets `failed` instead of crashing the page. */
export function useAction() {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        setFailed(false);
      } catch {
        setFailed(true); // optimistic values revert automatically when the transition ends
      }
    });
  return { pending, failed, run };
}

export function SaveError({ className = "" }: { className?: string }) {
  return (
    <p role="alert" className={`text-xs text-danger ${className}`}>
      Couldn&apos;t save — check your connection and try again.
    </p>
  );
}
