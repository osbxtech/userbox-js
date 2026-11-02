#!/usr/bin/env node
// Verifies a version after it was published, as a tenant would install it.
//
//   node scripts/verify-published.mjs --package <react|node> --version <X.Y.Z-alpha.N>
//
// 1. Poll `npm view <name>@<version> version` until the registry serves it (5 min max).
// 2. In a new temp dir with no workspace: `npm init -y`, then
//    `npm install <name>@<version> --save-exact` (+ react, react-dom, typescript
//    and the type packages for react; typescript for node).
// 3. Import every `exports` entry (ESM, plus `require` for CommonJS entries) and
//    type-check a fixture importing the public types (check-pack.mjs checkEntries).
// 4. `npm audit signatures` passes and reports a verified attestation for
//    <name>@<version> (provenance).
// 5. `npm view <name> dist-tags.alpha` equals <version>.
//
// Exit 0 when every step passes; exit 1 naming the failing step otherwise.
// Inputs arrive as arguments (the workflow passes them from env:). Processes are
// spawned with execFileSync, never through a shell.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkEntries } from "./check-pack.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["react", "node"];
const VERSION_RE = /^\d+\.\d+\.\d+-alpha\.\d+$/;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

// What a tenant installs next to the package. Majors follow the peer ranges;
// next and the type packages let the bundler-only `./nextjs` entry type-check.
const CONSUMER_DEPS = {
  react: ["react@19", "react-dom@19", "next@15", "typescript@5", "@types/react@19", "@types/node@22"],
  node: ["typescript@5", "@types/node@22"],
};

class VerifyError extends Error {}

function fail(step, message) {
  throw new VerifyError(`${step}: ${message}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--package" || arg === "--version") && i + 1 < argv.length) args[arg.slice(2)] = argv[++i];
    else fail("arguments", `unknown argument ${JSON.stringify(arg)}`);
  }
  if (!VERSION_RE.test(args.version ?? "")) fail("arguments", `version must be X.Y.Z-alpha.N, found ${JSON.stringify(args.version)}`);
  if (!PACKAGES.includes(args.package)) fail("arguments", `package must be react or node, found ${JSON.stringify(args.package)}`);
  return args;
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function npmViewVersion(spec) {
  try {
    return JSON.parse(run("npm", ["view", spec, "version", "--json"]) || "null");
  } catch {
    return null;
  }
}

async function waitForRegistry(spec, version) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (npmViewVersion(spec) === version) return;
    if (Date.now() >= deadline) fail("registry", `${spec} not visible after 5 min`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function checkAttestation(dir, name, version) {
  let report;
  try {
    report = JSON.parse(run("npm", ["audit", "signatures", "--json", "--include-attestations"], { cwd: dir }));
  } catch (err) {
    fail("signatures", `npm audit signatures failed (exit ${err.status ?? "?"})${err.stdout ? `\n${err.stdout}` : ""}`);
  }
  if ((report.invalid ?? []).length > 0) fail("signatures", `invalid signatures: ${JSON.stringify(report.invalid)}`);
  const ours = (report.verified ?? []).find((p) => p.name === name && p.version === version);
  if (!ours?.attestations) fail("signatures", `no verified attestation for ${name}@${version}`);
}

async function verify({ package: pkg, version }) {
  const manifestInRepo = JSON.parse(readFileSync(join(ROOT, pkg, "package.json"), "utf8"));
  const name = manifestInRepo.name;
  const spec = `${name}@${version}`;

  await waitForRegistry(spec, version);
  console.log(`verify-published: ${spec} is on the registry`);

  const dir = mkdtempSync(join(tmpdir(), `verify-${pkg}-`));
  try {
    run("npm", ["init", "-y"], { cwd: dir });
    run("npm", ["pkg", "set", "type=module"], { cwd: dir });
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--save-exact", spec, ...CONSUMER_DEPS[pkg]], {
      cwd: dir,
    });
    const installed = JSON.parse(readFileSync(join(dir, "node_modules", ...name.split("/"), "package.json"), "utf8"));
    if (installed.version !== version) fail("install", `expected ${version}, found ${installed.version}`);

    try {
      checkEntries(pkg, dir, installed);
    } catch (err) {
      const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
      fail("entries", `${err.message}${detail ? `\n${detail}` : ""}`);
    }
    console.log(`verify-published: every entry of ${spec} imports and type-checks`);

    checkAttestation(dir, name, version);
    console.log(`verify-published: ${spec} has a verified attestation`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const alpha = npmViewVersion(`${name}@alpha`);
  if (alpha !== version) fail("dist-tag", `expected alpha -> ${version}, found ${alpha ?? "none"}`);
  console.log(`verify-published: dist-tag alpha -> ${version}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verify(parseArgs(process.argv.slice(2)));
  } catch (err) {
    if (!(err instanceof VerifyError)) throw err;
    console.error(`verify-published: ${err.message}`);
    process.exit(1);
  }
}
