#!/usr/bin/env node
// Fails a pull request that changes a package's source without a changeset.
//
//   node scripts/check-changeset.mjs --base <commit sha>    # compares <sha>..HEAD
//
// A change under react/src/ or node/src/ needs at least one added or modified
// .changeset/*.md (README.md excluded). An empty changeset (`pnpm changeset
// --empty`) counts, for changes that release nothing.
//
// Exit 0 when the rule holds; exit 1 naming the source files otherwise.
// Runs in ci.yml on every pull request, forks included: it needs no secret.

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = /^(react|node)\/src\//;
const CHANGESET = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;

class CheckError extends Error {}

export function changesetProblem(changed, addedOrModified) {
  const sources = changed.filter((f) => SOURCE.test(f));
  if (sources.length === 0) return null;
  if (addedOrModified.some((f) => CHANGESET.test(f))) return null;
  return `package source changed without a changeset (run \`pnpm changeset\`): ${sources.join(", ")}`;
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--base") throw new CheckError("usage: check-changeset.mjs --base <commit sha>");
  const base = argv[1];
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(base)) throw new CheckError(`--base must be a full commit sha, found ${JSON.stringify(base)}`);
  return { base };
}

function diff(base, filter) {
  const args = ["diff", "--name-only", "--no-renames", ...(filter ? [`--diff-filter=${filter}`] : []), base, "HEAD"];
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
}

function main() {
  const { base } = parseArgs(process.argv.slice(2));
  const problem = changesetProblem(diff(base), diff(base, "AM"));
  if (problem) throw new CheckError(problem);
  console.log("check-changeset: ok");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof CheckError)) throw err;
    console.error(`check-changeset: ${err.message}`);
    process.exit(1);
  }
}
