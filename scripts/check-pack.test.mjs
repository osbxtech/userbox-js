// Tests for check-pack.mjs: bad tarballs must fail and name the offending entry.
// Run with: node --test scripts/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-pack.mjs");
const work = mkdtempSync(join(tmpdir(), "check-pack-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

const MANIFEST = {
  name: "@userbox/react",
  version: "0.0.0-test.0",
  license: "Apache-2.0",
  repository: { type: "git", url: "https://github.com/osbxtech/userbox-js.git", directory: "react" },
  exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./package.json": "./package.json" },
};

const GOOD = {
  "package.json": JSON.stringify(MANIFEST),
  "README.md": "# fixture\n",
  "LICENSE": "fixture\n",
  "dist/index.js": "export {};\n",
  "dist/index.d.ts": "export {};\n",
};

let counter = 0;
function tarball(files) {
  const root = join(work, `t${counter++}`);
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const full = join(root, "package", path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const out = `${root}.tgz`;
  const res = spawnSync("tar", ["-czf", out, "-C", root, "package"]);
  assert.equal(res.status, 0, String(res.stderr));
  return out;
}

function check(tgz) {
  return spawnSync(process.execPath, [SCRIPT, "--package", "react", "--tarball", tgz, "--no-smoke"], {
    encoding: "utf8",
  });
}

test("a clean tarball passes", () => {
  const res = check(tarball(GOOD));
  assert.equal(res.status, 0, res.stderr);
});

test("a source file fails and is named", () => {
  const res = check(tarball({ ...GOOD, "src/x.ts": "export {};\n" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /package\/src\/x\.ts/);
});

test("a .env file fails and is named", () => {
  const res = check(tarball({ ...GOOD, ".env": "SECRET=fixture\n" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /package\/\.env/);
});

test("a missing LICENSE fails and is named", () => {
  const res = check(tarball({ ...GOOD, LICENSE: undefined }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /required entry missing.*package\/LICENSE/);
});

test("a missing exports target fails and is named", () => {
  const res = check(tarball({ ...GOOD, "dist/index.d.ts": undefined }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /package\/dist\/index\.d\.ts/);
});

test("an unexpected file fails and is named", () => {
  const res = check(tarball({ ...GOOD, "notes.txt": "x\n" }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not in pack-allowlist: package\/notes\.txt/);
});

test("a workspace: specifier fails", () => {
  const manifest = { ...MANIFEST, dependencies: { "@userbox/config": "workspace:*" } };
  const res = check(tarball({ ...GOOD, "package.json": JSON.stringify(manifest) }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /workspace:\*/);
});
