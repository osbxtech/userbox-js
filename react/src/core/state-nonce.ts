/**
 * State-nonce storage for the auth-surface round-trip (CSRF / replay protection).
 *
 * The SDK MUST allow more than one in-flight sign-in flow per tab (e.g. user
 * opens sign-in in a popup while another tab races a refresh) without one
 * nonce overwriting another. We achieve this by storing a JSON map keyed by
 * `flowId` under the `ub.auth.state` `sessionStorage` key.
 *
 * Security note: `sessionStorage` writes here are the ONLY storage writes in
 * the SDK. They carry a random nonce, NOT credentials — S-1 invariant
 * (memory-only credentials) is preserved.
 */

const STORAGE_KEY = "ub.auth.state";
const MAX_FLOW_AGE_MS = 10 * 60 * 1000;

type StoredFlow = {
  nonce: string;
  createdAt: number;
};

type StoredMap = Record<string, StoredFlow>;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMap(storage: Storage): StoredMap {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: StoredMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null) continue;
      const flow = v as Partial<StoredFlow>;
      if (typeof flow.nonce === "string" && typeof flow.createdAt === "number") {
        out[k] = { nonce: flow.nonce, createdAt: flow.createdAt };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(storage: Storage, map: StoredMap): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota errors / disabled storage — silently ignore; the redirect will
    // still proceed but state validation will fail. Better UX than crashing.
  }
}

function pruneStale(map: StoredMap, now: number): StoredMap {
  const out: StoredMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (now - v.createdAt <= MAX_FLOW_AGE_MS) out[k] = v;
  }
  return out;
}

function generateRandom(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const buf = new Uint8Array(16);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last resort — non-crypto. Should never be reached in supported browsers.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export type NonceHandle = {
  flowId: string;
  nonce: string;
};

export function issueNonce(): NonceHandle {
  const flowId = generateRandom();
  const nonce = generateRandom();
  const storage = getStorage();
  if (storage) {
    const map = pruneStale(readMap(storage), Date.now());
    map[flowId] = { nonce, createdAt: Date.now() };
    writeMap(storage, map);
  }
  return { flowId, nonce };
}

/**
 * Look up the nonce for the given flowId. Single-use: the entry is removed
 * after retrieval, regardless of the comparison outcome.
 */
export function consumeNonce(flowId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  const map = pruneStale(readMap(storage), Date.now());
  const entry = map[flowId];
  if (!entry) {
    writeMap(storage, map);
    return null;
  }
  delete map[flowId];
  writeMap(storage, map);
  return entry.nonce;
}

/** Test-only: clear all stored flows. */
export function _clearAllNonces(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
