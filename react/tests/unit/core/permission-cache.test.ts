import { describe, expect, it } from "vitest";
import { PermissionCache } from "../../../src/core/permission-cache";
import { permissionFetchFailed } from "../../../src/core/errors";

describe("PermissionCache", () => {
  it("tracks loading → loaded transitions", () => {
    const cache = new PermissionCache();
    const promise = Promise.resolve(new Set<string>());
    cache.setLoading("w1", promise);
    expect(cache.get("w1")?.state).toBe("loading");
    cache.setLoaded("w1", ["read", "write"]);
    const entry = cache.get("w1");
    expect(entry?.state).toBe("loaded");
    if (entry?.state === "loaded") {
      expect(Array.from(entry.permissions)).toEqual(["read", "write"]);
    }
  });

  it("preserves last-good permissions on error after a successful load", () => {
    const cache = new PermissionCache();
    cache.setLoaded("w1", ["read"]);
    cache.setError("w1", permissionFetchFailed("fail", 500, "X", "w1"));
    const entry = cache.get("w1");
    expect(entry?.state).toBe("error");
    if (entry?.state === "error") {
      expect(entry.lastGood && Array.from(entry.lastGood)).toEqual(["read"]);
    }
  });

  it("clear wipes all entries", () => {
    const cache = new PermissionCache();
    cache.setLoaded("w1", ["a"]);
    cache.setLoaded("w2", ["b"]);
    cache.clear();
    expect(cache.get("w1")).toBeUndefined();
    expect(cache.get("w2")).toBeUndefined();
  });
});
