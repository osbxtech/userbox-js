import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve(__dirname, "../../dist");

describe("architectural: built bundle contains no localStorage / sessionStorage writes outside state-nonce", () => {
  it("dist/index.js and dist/nextjs.js do not contain credential storage writes", () => {
    const files = ["index.js", "nextjs.js"].map((f) => path.join(DIST_DIR, f));
    for (const f of files) {
      if (!existsSync(f)) continue;
      const src = readFileSync(f, "utf8");
      // localStorage.setItem MUST NEVER appear.
      expect(src).not.toMatch(/localStorage\s*\.\s*setItem/);
      // sessionStorage.setItem may appear ONLY within the state-nonce module.
      const matches = src.match(/sessionStorage\s*\.\s*setItem/g) ?? [];
      if (matches.length > 0) {
        // Permitted only if accompanied by the literal storage key "ub.auth.state".
        expect(src).toContain("ub.auth.state");
      }
    }
  });
});
