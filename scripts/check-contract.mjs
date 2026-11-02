#!/usr/bin/env node
// Checks every SDK call in contract/calls.json against the tenant API description.
//
//   node scripts/check-contract.mjs                          # vendored contract/tenant-openapi.json
//   node scripts/check-contract.mjs --description <file|url> # another copy, e.g. the live one
//
// For each call:
// 1. the operation (method and path template) exists in the description;
// 2. every required query/header/cookie parameter and every required body
//    property is in `sends` (path parameters are implicit);
// 3. every field in `reads` is a property of a 2xx JSON response schema,
//    with `$ref`, `allOf` (and every branch of `anyOf`/`oneOf`) resolved.
//
// Exit 0 when every call is compatible. Exit 1 printing one line per problem,
// "<package> <operation>: <problem>". Exit 2 when the description cannot be
// read: refused URL, fetch failure or timeout (10 s), invalid JSON, broken $ref.
//
// The description is data only. It is parsed with JSON.parse and walked; no
// part of it is ever passed to a shell, a template or eval.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DESCRIPTION = join(ROOT, "contract", "tenant-openapi.json");
const CALLS = join(ROOT, "contract", "calls.json");
const FETCH_TIMEOUT_MS = 10_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

class UnreadableError extends Error {}

function unreadable(message) {
  throw new UnreadableError(message);
}

function parseArgs(argv) {
  const args = { description: DEFAULT_DESCRIPTION };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--description" && i + 1 < argv.length) args.description = argv[++i];
    else unreadable(`unknown argument: ${arg}`);
  }
  return args;
}

function isUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

// Only https, except plain http to a loopback host for a local stack.
export function allowedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url;
  return null;
}

async function fetchDescription(value) {
  const url = allowedUrl(value);
  if (!url) unreadable(`refused URL ${value}: only https: (or http: to localhost) is allowed`);
  let res;
  try {
    // A redirect could leave https; refuse it instead of following.
    res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    unreadable(`fetch failed for ${url.href}: ${err.name === "TimeoutError" ? "timed out after 10 s" : err.message}`);
  }
  if (!res.ok) unreadable(`fetch failed for ${url.href}: HTTP ${res.status}`);
  return res.text();
}

export async function loadDescription(source) {
  let text;
  if (isUrl(source)) text = await fetchDescription(source);
  else {
    try {
      text = readFileSync(source, "utf8");
    } catch (err) {
      unreadable(`cannot read ${source}: ${err.code ?? err.message}`);
    }
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    unreadable(`${source} is not valid JSON: ${err.message}`);
  }
  if (!doc || typeof doc !== "object" || typeof doc.paths !== "object" || doc.paths === null) {
    unreadable(`${source} is not an OpenAPI description (no "paths" object)`);
  }
  return doc;
}

// Local JSON pointer only ("#/components/schemas/X"); anything else is unreadable.
function deref(doc, schema, seen = new Set()) {
  if (!schema || typeof schema !== "object" || typeof schema.$ref !== "string") return schema;
  const ref = schema.$ref;
  if (!ref.startsWith("#/")) unreadable(`unsupported $ref ${ref}: only local references are resolved`);
  if (seen.has(ref)) unreadable(`circular $ref ${ref}`);
  seen.add(ref);
  let target = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    target = target !== null && typeof target === "object" && Object.hasOwn(target, key) ? target[key] : undefined;
    if (target === undefined) unreadable(`broken $ref ${ref}`);
  }
  return deref(doc, target, seen);
}

const isNullSchema = (s) => s && typeof s === "object" && (s.type === "null" || (Array.isArray(s.type) && s.type.length === 1 && s.type[0] === "null"));

// Object view of a schema: its properties and required names, with $ref and
// allOf merged. For anyOf/oneOf, a property counts only if every non-null
// branch has it (a reader cannot rely on a field one branch lacks).
export function objectShape(doc, schema, depth = 0) {
  const out = { properties: new Set(), required: new Set() };
  if (depth > 32) unreadable("schema nesting deeper than 32 levels");
  const s = deref(doc, schema);
  if (!s || typeof s !== "object") return out;
  for (const name of Object.keys(s.properties ?? {})) out.properties.add(name);
  for (const name of Array.isArray(s.required) ? s.required : []) out.required.add(name);
  for (const part of Array.isArray(s.allOf) ? s.allOf : []) {
    const sub = objectShape(doc, part, depth + 1);
    sub.properties.forEach((p) => out.properties.add(p));
    sub.required.forEach((r) => out.required.add(r));
  }
  for (const key of ["anyOf", "oneOf"]) {
    const branches = (Array.isArray(s[key]) ? s[key] : []).map((b) => deref(doc, b)).filter((b) => !isNullSchema(b));
    if (branches.length === 0) continue;
    const shapes = branches.map((b) => objectShape(doc, b, depth + 1));
    for (const p of shapes[0].properties) if (shapes.every((sh) => sh.properties.has(p))) out.properties.add(p);
    for (const r of shapes[0].required) if (shapes.every((sh) => sh.required.has(r))) out.required.add(r);
  }
  return out;
}

function jsonSchema(doc, holder) {
  const resolved = deref(doc, holder);
  const content = resolved?.content ?? {};
  const type = Object.keys(content).find((t) => t === "application/json" || /\+json$/.test(t));
  return type ? content[type].schema : undefined;
}

export function checkCall(doc, call) {
  const label = `${call.package} ${call.operation}`;
  const [method, path] = call.operation.split(" ");
  const item = Object.hasOwn(doc.paths, path) ? doc.paths[path] : undefined;
  const key = method.toLowerCase();
  const op = item && typeof item === "object" && Object.hasOwn(item, key) ? item[key] : undefined;
  if (!op || typeof op !== "object") return [`${label}: operation not in description`];

  const problems = [];
  const sends = new Set(call.sends ?? []);

  const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(doc, p));
  for (const p of params) {
    if (!p?.required || p.in === "path") continue;
    if (!sends.has(p.name)) problems.push(`${label}: required ${p.in} parameter '${p.name}' not sent`);
  }

  if (op.requestBody) {
    const body = deref(doc, op.requestBody);
    const schema = jsonSchema(doc, body);
    if (schema) {
      for (const name of objectShape(doc, schema).required) {
        if (!sends.has(name)) problems.push(`${label}: required body property '${name}' not sent`);
      }
    }
  }

  const reads = call.reads ?? [];
  if (reads.length > 0) {
    const fields = new Set();
    for (const [code, response] of Object.entries(op.responses ?? {})) {
      if (!/^2(\d\d|XX)$/i.test(code)) continue;
      const schema = jsonSchema(doc, response);
      if (schema) objectShape(doc, schema).properties.forEach((f) => fields.add(f));
    }
    for (const field of reads) {
      if (!fields.has(field)) problems.push(`${label}: response field '${field}' not in 2xx schema`);
    }
  }
  return problems;
}

export function checkContract(doc, calls) {
  return calls.flatMap((call) => checkCall(doc, call));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = await loadDescription(args.description);
  const calls = JSON.parse(readFileSync(CALLS, "utf8"));
  const problems = checkContract(doc, calls);
  for (const line of problems) console.log(line);
  if (problems.length > 0) return 1;
  const commit = doc.info?.["x-userbox-platform-commit"] ?? "unknown";
  console.log(`check-contract: ok (${calls.length} calls; platform commit ${commit})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      if (!(err instanceof UnreadableError)) throw err;
      console.error(`check-contract: ${err.message}`);
      process.exit(2);
    },
  );
}
