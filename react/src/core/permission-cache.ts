import type { UserboxError } from "./errors";

export type PermissionCacheEntry =
  | { state: "loading"; promise: Promise<ReadonlySet<string>>; startedAt: number }
  | { state: "loaded"; permissions: ReadonlySet<string>; fetchedAt: number }
  | { state: "error"; error: UserboxError; failedAt: number; lastGood?: ReadonlySet<string> };

export class PermissionCache {
  private readonly entries = new Map<string, PermissionCacheEntry>();

  get(workspaceId: string): PermissionCacheEntry | undefined {
    return this.entries.get(workspaceId);
  }

  has(workspaceId: string): boolean {
    return this.entries.has(workspaceId);
  }

  setLoading(workspaceId: string, promise: Promise<ReadonlySet<string>>): void {
    this.entries.set(workspaceId, {
      state: "loading",
      promise,
      startedAt: Date.now(),
    });
  }

  setLoaded(workspaceId: string, permissions: Iterable<string>): void {
    const frozen = freezeSet(permissions);
    this.entries.set(workspaceId, {
      state: "loaded",
      permissions: frozen,
      fetchedAt: Date.now(),
    });
  }

  setError(workspaceId: string, error: UserboxError): void {
    const prior = this.entries.get(workspaceId);
    const lastGood =
      prior && prior.state === "loaded" ? prior.permissions : undefined;
    this.entries.set(workspaceId, lastGood !== undefined
      ? { state: "error", error, failedAt: Date.now(), lastGood }
      : { state: "error", error, failedAt: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }

  snapshot(): ReadonlyMap<string, PermissionCacheEntry> {
    return new Map(this.entries);
  }
}

function freezeSet(values: Iterable<string>): ReadonlySet<string> {
  const s = new Set<string>();
  for (const v of values) {
    if (typeof v === "string") s.add(v);
  }
  return s as ReadonlySet<string>;
}
