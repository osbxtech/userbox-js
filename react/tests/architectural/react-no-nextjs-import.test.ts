import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const REACT_DIR = path.resolve(__dirname, "../../src/react");

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

describe("architectural: src/react/ must not import next/*", () => {
  it("scans src/react/**/*.ts(x) for next imports", () => {
    const files = walk(REACT_DIR);
    const forbidden = /from\s+["']next(?:\/[^"']*)?["']/;
    const offences = files.filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offences).toEqual([]);
  });
});
