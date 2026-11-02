// Policy tests for .github/workflows: the release and secret rules, checked on
// every pull request so a later edit cannot quietly undo them.
// Run with: node --test "scripts/*.test.mjs"
//
// The checks read the YAML as text (no YAML dependency): job blocks are found
// by their two-space indent and `run:` scripts by their indentation.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".github", "workflows");
const WORKFLOWS = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => [f, readFileSync(join(DIR, f), "utf8")]),
);

const code = (text) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

function jobBlock(text, job) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${job}:`);
  assert.notEqual(start, -1, `job ${job} not found`);
  let end = lines.findIndex((l, i) => i > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n");
}

// Every `run:` script, one-line or block.
function runScripts(text) {
  const lines = text.split("\n");
  const scripts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (!/^[|>]/.test(m[2])) {
      scripts.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    const body = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === "" || lines[i + 1].search(/\S/) > indent)) body.push(lines[++i]);
    scripts.push(body.join("\n"));
  }
  return scripts;
}

function occurrences(pattern) {
  return Object.entries(WORKFLOWS).flatMap(([file, text]) =>
    code(text)
      .split("\n")
      .filter((l) => pattern.test(l))
      .map((l) => `${file}: ${l.trim()}`),
  );
}

test("the expected workflows exist", () => {
  for (const f of ["ci.yml", "integration.yml", "release.yml", "contract-sync.yml"]) assert.ok(WORKFLOWS[f], f);
});

test("no pull_request_target anywhere", () => {
  assert.deepEqual(occurrences(/pull_request_target/), []);
});

test("every workflow starts from an empty token (permissions: {})", () => {
  for (const [file, text] of Object.entries(WORKFLOWS)) assert.match(text, /^permissions: \{\}$/m, file);
});

test("SC-1: no ${{ }} expression inside any run: script", () => {
  for (const [file, text] of Object.entries(WORKFLOWS)) {
    for (const script of runScripts(text)) assert.doesNotMatch(script, /\$\{\{/, `${file}: ${script.trim().split("\n")[0]}`);
  }
});

test("only release.yml's publish job may mint an OIDC token", () => {
  assert.deepEqual(occurrences(/id-token:\s*write/), ["release.yml: id-token: write"]);
  assert.match(jobBlock(WORKFLOWS["release.yml"], "publish"), /id-token: write/);
});

test("only release.yml's tag job may write contents", () => {
  assert.deepEqual(occurrences(/contents:\s*write/), ["release.yml: contents: write"]);
  assert.match(jobBlock(WORKFLOWS["release.yml"], "tag"), /contents: write/);
});

test("SC-2: the publish job runs no project code", () => {
  const publish = code(jobBlock(WORKFLOWS["release.yml"], "publish"));
  assert.doesNotMatch(publish, /checkout|pnpm|npm (ci|install)|node scripts/);
  assert.match(publish, /environment: npm-publish/);
  assert.match(publish, /if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.match(publish, /EXPECTED_SHA256: \$\{\{ needs\.prepare\.outputs\.sha256 \}\}/);
});

test("FR-019: no registry token anywhere", () => {
  assert.deepEqual(occurrences(/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/), []);
  assert.doesNotMatch(readFileSync(join(ROOT, ".npmrc"), "utf8"), /_authToken/);
});

test("release dry_run defaults to true", () => {
  assert.match(WORKFLOWS["release.yml"], /dry_run:\n(?: {8}.*\n)*? {8}default: true/);
});

test("FR-025: integration.yml has no pull_request trigger and owns the environment", () => {
  const text = WORKFLOWS["integration.yml"];
  const on = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
  assert.doesNotMatch(on, /pull_request/);
  assert.match(jobBlock(text, "integration"), /environment: integration/);
});

test("SC-3: integration.yml never prints secrets or the environment", () => {
  assert.doesNotMatch(code(WORKFLOWS["integration.yml"]), /echo .*SECRET|set -x|printenv|env$/m);
});

test("secrets appear only in integration.yml", () => {
  for (const [file, text] of Object.entries(WORKFLOWS)) {
    if (file === "integration.yml") continue;
    assert.doesNotMatch(code(text), /secrets\./, file);
  }
});

test("every action is pinned to a commit sha", () => {
  for (const line of occurrences(/uses:/)) {
    if (/uses: \.\//.test(line)) continue;
    assert.match(line, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}\b/, line);
  }
});
