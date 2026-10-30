#!/usr/bin/env node
// Checks that a version may be released, before anything is built or published.
//
//   node scripts/check-release.mjs --package <react|node> --version <X.Y.Z-alpha.N>
//   --root <dir>    the repository root (default: this script's repository; for tests)
//
// The checks run in order and the first failure stops the run:
// 1. version   is X.Y.Z-alpha.N. Checked first: nothing else uses the value before.
// 2. manifest  <pkg>/package.json "version" equals it.
// 3. changelog the top version heading of <pkg>/CHANGELOG.md equals it
//              (Changesets "## X" or Keep a Changelog "## [X] — date").
// 4. tag       <pkg>-v<version> does not exist on origin (git ls-remote --tags).
// 5. registry  <name>@<version> is not on npm. E404 for the version, or for the
//              whole package on a first release, counts as absent; any other npm
//              error fails closed.
// 6. dist-tag  derived from the version, never chosen: alpha. Written as
//              "dist-tag=alpha" to $GITHUB_OUTPUT when it is set.
//
// Exit 0 when every check passes. Exit 1 with
// "check-release: <check>: expected <a>, found <b>" otherwise.
//
// Inputs arrive as arguments (the workflow passes them from env:). Processes are
// spawned with execFileSync, never through a shell.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["react", "node"];
const VERSION_RE = /^\d+\.\d+\.\d+-alpha\.\d+$/;

class CheckError extends Error {}

function fail(check, expected, found) {
  throw new CheckError(`${check}: expected ${expected}, found ${found}`);
}

function parseArgs(argv) {
  const args = { package: null, version: null, root: resolve(dirname(fileURLToPath(import.meta.url)), "..") };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--package" && value !== undefined) args.package = argv[++i];
    else if (arg === "--version" && value !== undefined) args.version = argv[++i];
    else if (arg === "--root" && value !== undefined) args.root = resolve(argv[++i]);
    else throw new CheckError(`arguments: expected --package <react|node> --version <X.Y.Z-alpha.N>, found ${JSON.stringify(arg)}`);
  }
  return args;
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

// The first "## " heading that carries a version: "## 1.0.0-alpha.1" or "## [1.0.0-alpha.1] — 2026-10-30".
export function topChangelogVersion(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+\[?([0-9][^\]\s]*)\]?(?:\s|$)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

// npm view <spec> version --json: a version string when published; an
// {"error":{"code":"E404"}} body (or, with older npm, empty output) when absent.
export function registryState(status, stdout) {
  const text = stdout.trim();
  if (status === 0) return text === "" ? "absent" : "published";
  try {
    if (JSON.parse(text)?.error?.code === "E404") return "absent";
  } catch {
    // Not JSON: fall through and fail closed.
  }
  return "error";
}

function checkRelease(args) {
  // 1. version — before any other use of the value.
  if (typeof args.version !== "string" || !VERSION_RE.test(args.version)) {
    fail("version", "X.Y.Z-alpha.N", JSON.stringify(args.version));
  }
  if (!PACKAGES.includes(args.package)) fail("package", PACKAGES.join(" or "), JSON.stringify(args.package));
  const { version } = args;
  const dir = join(args.root, args.package);

  // 2. manifest
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (manifest.version !== version) fail("manifest", `${args.package}/package.json version ${version}`, manifest.version);

  // 3. changelog
  const top = topChangelogVersion(readFileSync(join(dir, "CHANGELOG.md"), "utf8"));
  if (top !== version) fail("changelog", `${args.package}/CHANGELOG.md top heading ${version}`, top ?? "no version heading");

  // 4. tag
  const tag = `${args.package}-v${version}`;
  let refs;
  try {
    refs = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { cwd: args.root }).trim();
  } catch (err) {
    fail("tag", `git ls-remote to succeed`, `exit ${err.status ?? "?"}`);
  }
  if (refs !== "") fail("tag", `${tag} absent on origin`, `${tag} present`);

  // 5. registry
  const spec = `${manifest.name}@${version}`;
  let status = 0;
  let stdout;
  try {
    stdout = run("npm", ["view", spec, "version", "--json"], { cwd: args.root });
  } catch (err) {
    status = err.status ?? 1;
    stdout = String(err.stdout ?? "");
  }
  const state = registryState(status, stdout);
  if (state === "published") fail("registry", `${spec} absent`, `${spec} published`);
  if (state === "error") fail("registry", `npm view ${spec} to return the version or E404`, `exit ${status}`);

  // 6. dist-tag — derived, there is no input for it.
  const distTag = version.split("-")[1].split(".")[0];
  if (distTag !== "alpha") fail("dist-tag", "alpha", distTag);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `dist-tag=${distTag}\n`);
  return { tag, spec, distTag };
}

function main() {
  const result = checkRelease(parseArgs(process.argv.slice(2)));
  console.log(`check-release: ok (${result.spec}, tag ${result.tag}, dist-tag=${result.distTag})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof CheckError)) throw err;
    console.error(`check-release: ${err.message}`);
    process.exit(1);
  }
}
