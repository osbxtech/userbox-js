import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const CORE_DIR = path.resolve(__dirname, "../../src/core");
const FORBIDDEN_PATTERNS = [/from\s+["']react(?:\/[^"']*)?["']/m, /from\s+["']next(?:\/[^"']*)?["']/m];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("architectural: core/ must not import react or next", () => {
  it("scans src/core/**/*.ts(x) for forbidden imports", () => {
    const files = walk(CORE_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offences: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(src)) {
          offences.push(`${path.relative(CORE_DIR, f)}: ${pattern.source}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});
