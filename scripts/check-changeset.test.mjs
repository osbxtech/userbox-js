// Tests for check-changeset.mjs: source changes need a changeset.
// Run with: node --test "scripts/*.test.mjs"

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { changesetProblem } from "./check-changeset.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-changeset.mjs");

test("a react/src change without a changeset fails and names the file", () => {
  const problem = changesetProblem(["react/src/core/http.ts", "README.md"], ["react/src/core/http.ts"]);
  assert.match(problem, /without a changeset .*: react\/src\/core\/http\.ts$/);
});

test("a node/src change with a changeset passes", () => {
  const files = ["node/src/client.ts", ".changeset/brave-owls-sing.md"];
  assert.equal(changesetProblem(files, files), null);
});

test("the changesets README does not count as a changeset", () => {
  const files = ["node/src/client.ts", ".changeset/README.md"];
  assert.ok(changesetProblem(files, files));
});

test("a deleted changeset does not count", () => {
  assert.ok(changesetProblem(["node/src/client.ts", ".changeset/old.md"], ["node/src/client.ts"]));
});

test("docs, tests and workflow changes need no changeset", () => {
  const files = ["docs/releasing.md", "node/tests/x.test.ts", ".github/workflows/ci.yml", "react/README.md"];
  assert.equal(changesetProblem(files, files), null);
});

test("--base must be a full commit sha", () => {
  const res = spawnSync(process.execPath, [SCRIPT, "--base", "main;id"], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--base must be a full commit sha, found "main;id"/);
});
