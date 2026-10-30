#!/usr/bin/env node
// Refreshes the vendored tenant API description from the deployed platform.
//
//   pnpm contract:sync                                   # $USERBOX_TENANT_OPENAPI_URL
//   pnpm contract:sync -- --description <file|url>
//   --out <file>    write there instead (the contract-sync workflow compares it)
//
// Writes contract/tenant-openapi.json in the platform snapshot's format: keys
// sorted, 2-space indent, non-ASCII escaped, trailing newline. Then run
// `pnpm check:contract` and open the sync pull request. The contract-sync
// workflow only reports drift in an issue; this script is how the vendored
// copy changes.

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDescription } from "./check-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "contract", "tenant-openapi.json");

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys(value[k])]),
  );
}

// Same output as the platform's export (Python json.dumps, sort_keys, indent=2).
export function formatDescription(doc) {
  const text = JSON.stringify(sortKeys(doc), null, 2).replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `${text}\n`;
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  let source = process.env.USERBOX_TENANT_OPENAPI_URL;
  let out = TARGET;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--description" && i + 1 < argv.length) source = argv[++i];
    else if (argv[i] === "--out" && i + 1 < argv.length) out = resolve(argv[++i]);
    else throw new Error("usage: sync-contract.mjs [--description <file|url>] [--out <file>]");
  }
  if (!source) throw new Error("set USERBOX_TENANT_OPENAPI_URL or pass --description <file|url>");
  const doc = await loadDescription(source);
  writeFileSync(out, formatDescription(doc));
  console.log(`contract:sync: wrote ${out} (platform commit ${doc.info?.["x-userbox-platform-commit"] ?? "unknown"})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`contract:sync: ${err.message}`);
    process.exit(err.constructor.name === "UnreadableError" ? 2 : 1);
  });
}
