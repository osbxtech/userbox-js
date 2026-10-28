/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from "vitest";
import { issueNonce, consumeNonce, _clearAllNonces } from "../../../src/core/state-nonce";

beforeEach(() => {
  _clearAllNonces();
});

describe("state-nonce multi-flow", () => {
  it("two concurrent flows co-exist; consuming one does not affect the other", () => {
    const a = issueNonce();
    const b = issueNonce();
    expect(consumeNonce(a.flowId)).toBe(a.nonce);
    // Flow B still resolvable after A was consumed.
    expect(consumeNonce(b.flowId)).toBe(b.nonce);
  });

  it("unknown flowId returns null", () => {
    expect(consumeNonce("nonexistent")).toBeNull();
  });
});
