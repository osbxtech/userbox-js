/**
 * Architectural: every API path the SDK source calls is listed in
 * `contract/calls.json` for this package.
 *
 * Collects every string and template literal under `src/` that contains
 * `/v1/` or `/.well-known/` (comments are not literals, so they are ignored),
 * strips a leading `${…}` base-URL interpolation and any query string, turns
 * the remaining `${…}` segments into `{param}`, and requires a manifest entry
 * whose path matches with parameters compared by position.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGE = "node";
const PKG_ROOT = resolve(__dirname, "..", "..");
const SRC = join(PKG_ROOT, "src");
const MANIFEST = resolve(PKG_ROOT, "..", "contract", "calls.json");
const HOLE = "\u0000";

interface CallEntry {
  package: string;
  operation: string;
}

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function normalisePath(raw: string): string | null {
  if (!raw.includes("/v1/") && !raw.includes("/.well-known/")) return null;
  let path = raw.startsWith(HOLE) ? raw.slice(HOLE.length) : raw;
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  return path.split(HOLE).join("{param}");
}

function collectApiPaths(sourceText: string, fileName: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    let raw: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      raw = node.text;
    } else if (ts.isTemplateExpression(node)) {
      raw = node.head.text + node.templateSpans.map((s) => HOLE + s.literal.text).join("");
    }
    if (raw !== null) {
      const path = normalisePath(raw);
      if (path !== null) found.push(path);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function manifestPaths(entries: CallEntry[], pkg: string): Set<string> {
  return new Set(
    entries
      .filter((e) => e.package === pkg)
      .map((e) => e.operation.split(" ")[1]!.replace(/\{[^}]+\}/g, "{param}")),
  );
}

function findUnlisted(paths: string[], entries: CallEntry[], pkg: string): string[] {
  const listed = manifestPaths(entries, pkg);
  return [...new Set(paths)].filter((p) => !listed.has(p));
}

const entries = JSON.parse(readFileSync(MANIFEST, "utf8")) as CallEntry[];

describe("architectural: contract/calls.json lists every API call", () => {
  it("every /v1/ and /.well-known/ literal in src/ has a manifest entry", () => {
    const paths = listSources(SRC).flatMap((f) => collectApiPaths(readFileSync(f, "utf8"), f));
    // Not vacuous: the SDK makes calls, so the scan must find some.
    expect(paths.length).toBeGreaterThan(0);
    expect(findUnlisted(paths, entries, PACKAGE)).toEqual([]);
  });

  it("reports a call that is missing from the manifest", () => {
    const fixture = [
      "// GET /v1/in-a-comment is ignored",
      "const a = `/v1/users/${encodeURIComponent(id)}`;",
      "const b = `${base}/v1/not-in-manifest/${encodeURIComponent(id)}?x=1`;",
    ].join("\n");
    const paths = collectApiPaths(fixture, "fixture.ts");
    expect(paths).toEqual(["/v1/users/{param}", "/v1/not-in-manifest/{param}"]);
    expect(findUnlisted(paths, entries, PACKAGE)).toEqual(["/v1/not-in-manifest/{param}"]);
  });
});
