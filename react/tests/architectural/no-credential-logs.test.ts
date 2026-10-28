import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve(__dirname, "../../dist");
const TARGETS = ["index.js", "nextjs.js"];

describe("architectural: built bundle does not log credentials", () => {
  it("no console.log/warn/error template contains access_token/refresh_token/password/Authorization", () => {
    for (const target of TARGETS) {
      const p = path.join(DIST_DIR, target);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, "utf8");
      const pattern = /console\.(log|warn|error)\s*\([^)]*?(?:access_token|refresh_token|password|Authorization)[^)]*?\)/;
      expect(src).not.toMatch(pattern);
    }
  });
});
