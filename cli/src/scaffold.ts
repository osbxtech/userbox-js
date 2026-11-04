import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { NextProject } from "./project.js";

// The auth glue from llms.txt, written only where no file exists yet. Existing
// files are never overwritten; the layout is edited only when the change is
// unambiguous.

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
  /** Things the CLI could not do safely; the human or agent does them. */
  todo: string[];
}

function providers(ts: boolean): string {
  const props = ts ? "{ children }: { children: React.ReactNode }" : "{ children }";
  const bang = ts ? "!" : "";
  return `"use client";
import { UserboxProvider } from "@userbox/react";

export function Providers(${props}) {
  return (
    <UserboxProvider
      tenantSlug={process.env.NEXT_PUBLIC_USERBOX_TENANT_SLUG${bang}}
      baseUrl={process.env.NEXT_PUBLIC_USERBOX_API_URL${bang}}
      tokenStorage="cookie"
      refreshUrl="/api/auth/refresh"
    >
      {children}
    </UserboxProvider>
  );
}
`;
}

const CALLBACK = `"use client";
import { useRouter } from "next/navigation";
import { UserboxCallback } from "@userbox/react";

export default function Callback() {
  const router = useRouter();
  return <UserboxCallback onSuccess={() => router.replace("/")} onError={(e) => console.error(e.message)} />;
}
`;

const REFRESH = `import { createRefreshHandler } from "@userbox/react/nextjs";

export const { POST } = createRefreshHandler();
`;

function writeIfMissing(root: string, rel: string, content: string, result: ScaffoldResult): void {
  const path = join(root, rel);
  if (existsSync(path)) {
    result.skipped.push(rel);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  result.written.push(rel);
}

/**
 * Wrap `{children}` in the root layout with `<Providers>`. Returns the new
 * text, or null when the layout already uses Providers or the edit is not
 * obvious (zero or several `{children}`).
 */
export function wrapLayout(text: string, importPath: string): string | null {
  if (/<Providers[\s>]/.test(text)) return null;
  const occurrences = text.split("{children}").length - 1;
  if (occurrences !== 1) return null;
  const wrapped = text.replace("{children}", "<Providers>{children}</Providers>");
  const importLine = `import { Providers } from "${importPath}";\n`;
  const lastImport = [...wrapped.matchAll(/^import .*$/gm)].pop();
  if (!lastImport || lastImport.index === undefined) return importLine + wrapped;
  const at = lastImport.index + lastImport[0].length;
  return `${wrapped.slice(0, at)}\n${importLine.trimEnd()}${wrapped.slice(at)}`;
}

export function scaffold(project: NextProject): ScaffoldResult {
  const result: ScaffoldResult = { written: [], skipped: [], todo: [] };
  const { root, appDir, typescript: ts } = project;
  const x = ts ? "tsx" : "jsx";
  const s = ts ? "ts" : "js";

  writeIfMissing(root, `${appDir}/providers.${x}`, providers(ts), result);
  writeIfMissing(root, `${appDir}/auth/callback/page.${x}`, CALLBACK, result);
  writeIfMissing(root, `${appDir}/api/auth/refresh/route.${s}`, REFRESH, result);

  const layoutRel = [`${appDir}/layout.tsx`, `${appDir}/layout.jsx`, `${appDir}/layout.js`].find((p) =>
    existsSync(join(root, p)),
  );
  if (!layoutRel) {
    result.todo.push(`Wrap {children} in your root layout with <Providers> from ./providers.`);
    return result;
  }
  const layoutPath = join(root, layoutRel);
  const layout = readFileSync(layoutPath, "utf8");
  if (/<Providers[\s>]/.test(layout)) {
    result.skipped.push(layoutRel);
    return result;
  }
  const next = wrapLayout(layout, "./providers");
  if (next === null) {
    result.todo.push(`Wrap {children} in ${layoutRel} with <Providers> (import { Providers } from "./providers").`);
  } else {
    writeFileSync(layoutPath, next);
    result.written.push(`${layoutRel} (wrapped {children} with <Providers>)`);
  }
  return result;
}
