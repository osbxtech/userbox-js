import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.clear();
      window.localStorage.clear();
    } catch {
      // jsdom may throw if storage is unavailable; ignore.
    }
  }
});
