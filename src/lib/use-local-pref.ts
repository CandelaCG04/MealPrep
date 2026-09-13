"use client";

import { useSyncExternalStore } from "react";

const EVENT = "local-pref-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

/**
 * A string preference remembered in this browser (e.g. list vs grid).
 * Falls back to `fallback` on the server, on first visit, or when storage is blocked.
 */
export function useLocalPref(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const set = (next: string) => {
    try {
      localStorage.setItem(key, next);
    } catch {
      // storage unavailable (private mode etc.) — preference just won't persist
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [value, set];
}
