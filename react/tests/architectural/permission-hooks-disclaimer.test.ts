import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const USE_PERMISSION = path.resolve(__dirname, "../../src/react/usePermission.ts");

describe("architectural: usePermission JSDoc carries UI HINTS ONLY disclaimer", () => {
  it("JSDoc contains the literal phrase", () => {
    const src = readFileSync(USE_PERMISSION, "utf8");
    expect(src).toContain("UI HINTS ONLY");
  });
});
