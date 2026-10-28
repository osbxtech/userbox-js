import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DTS = path.resolve(__dirname, "../../dist/index.d.ts");

describe("architectural: dist/index.d.ts does not expose accessToken (PublicSession/ServerSession split)", () => {
  it("scan", () => {
    if (!existsSync(DTS)) {
      throw new Error(`dist/index.d.ts not found — run pnpm build first`);
    }
    const src = readFileSync(DTS, "utf8");
    expect(src).not.toContain("accessToken");
  });
});
