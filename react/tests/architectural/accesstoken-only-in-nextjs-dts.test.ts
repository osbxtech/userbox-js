import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DTS = path.resolve(__dirname, "../../dist/nextjs.d.ts");

describe("architectural: dist/nextjs.d.ts carries accessToken with security warning", () => {
  it("includes accessToken and a JSDoc forbidding pass-through to Client Components", () => {
    if (!existsSync(DTS)) {
      throw new Error(`dist/nextjs.d.ts not found — run pnpm build first`);
    }
    const src = readFileSync(DTS, "utf8");
    expect(src).toContain("accessToken");
    expect(src).toContain("MUST NOT be passed");
  });
});
