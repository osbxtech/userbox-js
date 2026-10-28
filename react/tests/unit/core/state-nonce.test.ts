/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from "vitest";
import { issueNonce, consumeNonce, _clearAllNonces } from "../../../src/core/state-nonce";

beforeEach(() => {
  _clearAllNonces();
});

describe("state-nonce", () => {
  it("issueNonce returns a fresh random handle each time", () => {
    const a = issueNonce();
    const b = issueNonce();
    expect(a.flowId).not.toBe(b.flowId);
    expect(a.nonce).not.toBe(b.nonce);
    expect(typeof a.nonce).toBe("string");
    expect(a.nonce.length).toBeGreaterThanOrEqual(16);
  });

  it("consumeNonce is single-use", () => {
    const { flowId, nonce } = issueNonce();
    expect(consumeNonce(flowId)).toBe(nonce);
    expect(consumeNonce(flowId)).toBeNull();
  });

  it("only writes to sessionStorage under the ub.auth.state key", () => {
    expect(window.sessionStorage.length).toBe(0);
    issueNonce();
    expect(window.sessionStorage.getItem("ub.auth.state")).not.toBeNull();
    expect(window.localStorage.getItem("ub.auth.state")).toBeNull();
  });
});
