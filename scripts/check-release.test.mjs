// Tests for check-release.mjs: one failing case per check, each naming the value.
// Run with: node --test "scripts/*.test.mjs"
//
// `git` and `npm` are replaced by stubs on PATH, so no network is used.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { registryState, topChangelogVersion } from "./check-release.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-release.mjs");
const VERSION = "1.0.0-alpha.0";
const work = mkdtempSync(join(tmpdir(), "check-release-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

// Stubs print $STUB_<TOOL>_OUT and exit with $STUB_<TOOL>_STATUS.
const bin = join(work, "bin");
mkdirSync(bin);
for (const tool of ["git", "npm"]) {
  const upper = tool.toUpperCase();
  const file = join(bin, tool);
  writeFileSync(file, `#!/bin/sh\nprintf '%s' "$STUB_${upper}_OUT"\nexit "\${STUB_${upper}_STATUS:-0}"\n`);
  chmodSync(file, 0o755);
}

const NPM_E404 = JSON.stringify({ error: { code: "E404", summary: "Not Found" } });

let counter = 0;
function repo({ version = VERSION, changelog = `# Changelog\n\n## [${VERSION}] — 2026-10-30\n\n- First alpha.\n` } = {}) {
  const root = join(work, `r${counter++}`);
  mkdirSync(join(root, "react"), { recursive: true });
  writeFileSync(join(root, "react", "package.json"), JSON.stringify({ name: "@userbox/react", version }));
  writeFileSync(join(root, "react", "CHANGELOG.md"), changelog);
  return root;
}

function check({ root = repo(), pkg = "react", version = VERSION, git = "", npm = NPM_E404, npmStatus = 1 } = {}) {
  const output = join(work, `out${counter++}`);
  writeFileSync(output, "");
  const res = spawnSync(process.execPath, [SCRIPT, "--package", pkg, "--version", version, "--root", root], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      STUB_GIT_OUT: git,
      STUB_NPM_OUT: npm,
      STUB_NPM_STATUS: String(npmStatus),
    },
  });
  return { ...res, output: readFileSync(output, "utf8") };
}

test("a valid first release passes and writes dist-tag=alpha", () => {
  const res = check();
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.output, "dist-tag=alpha\n");
});

test("a Changesets heading (## X) is accepted", () => {
  const res = check({ root: repo({ changelog: `# @userbox/react\n\n## ${VERSION}\n\n### Patch Changes\n` }) });
  assert.equal(res.status, 0, res.stderr);
});

test("an existing package without this version (npm exit 0, empty output) passes", () => {
  const res = check({ npm: "", npmStatus: 0 });
  assert.equal(res.status, 0, res.stderr);
});

test("check 1: a stable version is refused", () => {
  const res = check({ version: "1.0.0" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^check-release: version: expected X\.Y\.Z-alpha\.N, found "1\.0\.0"$/m);
  assert.equal(res.output, "");
});

test("check 1: a beta version is refused", () => {
  const res = check({ version: "1.0.0-beta.1" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /version: expected X\.Y\.Z-alpha\.N, found "1\.0\.0-beta\.1"/);
});

test("check 1: shell metacharacters are refused before any other use", () => {
  // If the value reached git or npm, the stubs would be called; a broken
  // package name proves no later check ran.
  const res = check({ version: "1.0.0-alpha.0;id", pkg: "../../etc" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /version: expected X\.Y\.Z-alpha\.N, found "1\.0\.0-alpha\.0;id"/);
});

test("an unknown package is refused", () => {
  const res = check({ pkg: "cli" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /package: expected react or node, found "cli"/);
});

test("check 2: package.json version mismatch names both values", () => {
  const res = check({ root: repo({ version: "1.0.0-alpha.1" }) });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /manifest: expected react\/package\.json version 1\.0\.0-alpha\.0, found 1\.0\.0-alpha\.1/);
});

test("check 3: CHANGELOG top heading mismatch names both values", () => {
  const res = check({ root: repo({ changelog: "# Changelog\n\n## [0.9.0] — 2026-01-01\n" }) });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /changelog: expected react\/CHANGELOG\.md top heading 1\.0\.0-alpha\.0, found 0\.9\.0/);
});

test("check 4: an existing tag fails", () => {
  const res = check({ git: "0123456789abcdef0123456789abcdef01234567\trefs/tags/react-v1.0.0-alpha.0\n" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /tag: expected react-v1\.0\.0-alpha\.0 absent on origin, found react-v1\.0\.0-alpha\.0 present/);
});

test("check 5: a version already on the registry fails", () => {
  const res = check({ npm: `"${VERSION}"`, npmStatus: 0 });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /registry: expected @userbox\/react@1\.0\.0-alpha\.0 absent, found @userbox\/react@1\.0\.0-alpha\.0 published/);
});

test("check 5: any other npm error fails closed", () => {
  const res = check({ npm: JSON.stringify({ error: { code: "E500" } }), npmStatus: 1 });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /registry: expected npm view @userbox\/react@1\.0\.0-alpha\.0 to return the version or E404, found exit 1/);
  assert.equal(res.output, "");
});

test("check 6: the dist-tag is derived from the version", () => {
  assert.equal(check().output, "dist-tag=alpha\n");
});

test("topChangelogVersion reads both heading styles and skips non-version headings", () => {
  assert.equal(topChangelogVersion("# T\n\n## Unreleased notes\n## 1.2.3-alpha.4\n"), "1.2.3-alpha.4");
  assert.equal(topChangelogVersion("## [1.0.0-alpha.0] — 2026-05-18\n"), "1.0.0-alpha.0");
  assert.equal(topChangelogVersion("# nothing\n"), null);
});

test("registryState", () => {
  assert.equal(registryState(1, NPM_E404), "absent");
  assert.equal(registryState(0, ""), "absent");
  assert.equal(registryState(0, '"1.0.0-alpha.0"'), "published");
  assert.equal(registryState(1, "npm error network"), "error");
});
