import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SERVER_TS = path.resolve(__dirname, "../../src/nextjs/server.ts");

describe("architectural: getSession() never mutates cookies", () => {
  it("server.ts contains no cookies().set / cookies().delete call", () => {
    const src = readFileSync(SERVER_TS, "utf8");
    expect(src).not.toMatch(/cookies\(\)\s*\.\s*set\s*\(/);
    expect(src).not.toMatch(/cookies\(\)\s*\.\s*delete\s*\(/);
  });
});
