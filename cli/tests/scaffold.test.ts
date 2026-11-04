import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { detectNextProject } from "../src/project.js";
import { scaffold, wrapLayout } from "../src/scaffold.js";

const LAYOUT = `import type { Metadata } from "next";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

function nextApp(): string {
  const root = mkdtempSync(join(tmpdir(), "ub-cli-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
  writeFileSync(join(root, "tsconfig.json"), "{}");
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "layout.tsx"), LAYOUT);
  return root;
}

describe("wrapLayout", () => {
  it("wraps the single {children} and adds the import after the last import", () => {
    const out = wrapLayout(LAYOUT, "./providers")!;
    expect(out).toContain("<body><Providers>{children}</Providers></body>");
    expect(out).toContain('import "./globals.css";\nimport { Providers } from "./providers";');
  });

  it("leaves ambiguous or already-wrapped layouts alone", () => {
    expect(wrapLayout("{children}{children}", "./p")).toBeNull();
    expect(wrapLayout("<Providers>{children}</Providers>", "./p")).toBeNull();
  });
});

describe("scaffold", () => {
  it("writes the auth glue once and is a no-op on the second run", () => {
    const root = nextApp();
    const project = detectNextProject(root);
    const first = scaffold(project);
    expect(first.written).toHaveLength(4);
    expect(readFileSync(join(root, "app/api/auth/refresh/route.ts"), "utf8")).toContain("createRefreshHandler");
    const second = scaffold(project);
    expect(second.written).toEqual([]);
    expect(second.skipped).toHaveLength(4);
  });

  it("refuses a project without next", () => {
    const root = mkdtempSync(join(tmpdir(), "ub-cli-"));
    writeFileSync(join(root, "package.json"), "{}");
    expect(() => detectNextProject(root)).toThrow(/not a Next.js app/);
  });
});
