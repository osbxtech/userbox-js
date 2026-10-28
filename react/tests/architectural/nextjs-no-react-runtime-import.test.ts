import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const NEXTJS_DIR = path.resolve(__dirname, "../../src/nextjs");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("architectural: src/nextjs/ must not import from src/react/", () => {
  it("scans src/nextjs/**/*.ts(x) for react/ imports", () => {
    const files = walk(NEXTJS_DIR);
    const forbidden = /from\s+["'](?:\.\.\/)+react(?:\/[^"']*)?["']/;
    const offences = files.filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offences).toEqual([]);
  });
});
