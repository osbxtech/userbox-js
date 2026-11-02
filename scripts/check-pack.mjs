#!/usr/bin/env node
// Checks a package tarball before it can be published.
//
//   node scripts/check-pack.mjs                                   # pack and check every package
//   node scripts/check-pack.mjs --package <react|node>            # pack and check one package
//   node scripts/check-pack.mjs --package <name> --tarball <tgz>  # check an existing tarball
//   --no-smoke                                                    # contents and manifest only
//
// 1. Every tarball entry matches <pkg>/pack-allowlist.json "allow", none matches
//    "forbid", and every "require" entry (plus every `exports` target) is present.
// 2. The packed manifest has no workspace: specifiers and carries license,
//    repository.url and repository.directory.
// 3. Smoke: install the tarball into a temp dir outside the workspace, assert
//    node_modules/@userbox/<name> is a real directory, import every entry
//    (and `require` the CommonJS ones; bundler-only entries are resolved, not
//    imported) and type-check a fixture.
//
// Exit 0 when everything passes; exit 1 naming the offending entry otherwise.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["react", "node"];

class CheckError extends Error {}

function fail(message) {
  throw new CheckError(message);
}

function parseArgs(argv) {
  const args = { packages: PACKAGES, tarball: null, smoke: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--package") args.packages = [argv[++i]];
    else if (arg === "--tarball") args.tarball = argv[++i];
    else if (arg === "--no-smoke") args.smoke = false;
    else fail(`unknown argument: ${arg}`);
  }
  for (const pkg of args.packages) {
    if (!PACKAGES.includes(pkg)) fail(`unknown package: ${pkg}`);
  }
  if (args.tarball && args.packages.length !== 1) fail("--tarball needs --package");
  return args;
}

// Glob → RegExp: `**/` any directories, `*` within a segment, `{a,b}` alternatives.
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else {
        out += ".*";
      }
    } else if (c === "*") out += "[^/]*";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      out += "(?:" + glob.slice(i + 1, end).split(",").map(escape).join("|") + ")";
      i = end;
    } else out += escape(c);
  }
  return new RegExp(`^${out}$`);
}

function escape(s) {
  return s.replace(/[.+?^$()|[\]\\]/g, "\\$&");
}

function matchesAny(entry, globs) {
  return globs.some((g) => globToRegExp(g).test(entry));
}

function exportTargets(exportsField) {
  if (typeof exportsField === "string") return [exportsField];
  if (!exportsField || typeof exportsField !== "object") return [];
  return Object.values(exportsField).flatMap(exportTargets);
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function pack(pkg, dest) {
  run("pnpm", ["pack", "--pack-destination", dest], { cwd: join(ROOT, pkg) });
  const manifest = JSON.parse(readFileSync(join(ROOT, pkg, "package.json"), "utf8"));
  const base = manifest.name.replace(/^@/, "").replace("/", "-");
  return join(dest, `${base}-${manifest.version}.tgz`);
}

export function checkContents(pkg, entries, manifest) {
  const allowlist = JSON.parse(readFileSync(join(ROOT, pkg, "pack-allowlist.json"), "utf8"));
  const files = entries.filter((e) => !e.endsWith("/"));
  for (const entry of files) {
    if (matchesAny(entry, allowlist.forbid)) fail(`${pkg}: forbidden entry in tarball: ${entry}`);
    if (!matchesAny(entry, allowlist.allow)) fail(`${pkg}: entry not in pack-allowlist: ${entry}`);
  }
  const required = [
    ...allowlist.require,
    ...exportTargets(manifest.exports).map((t) => `package/${t.replace(/^\.\//, "")}`),
  ];
  for (const entry of required) {
    if (!files.includes(entry)) fail(`${pkg}: required entry missing from tarball: ${entry}`);
  }
}

export function checkManifest(pkg, manifest) {
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (String(spec).startsWith("workspace:")) fail(`${pkg}: ${field}.${name} uses ${spec}`);
    }
  }
  if (!manifest.license) fail(`${pkg}: package.json has no license`);
  if (!manifest.repository?.url) fail(`${pkg}: package.json has no repository.url`);
  if (!manifest.repository?.directory) fail(`${pkg}: package.json has no repository.directory`);
}

function readTarball(tarball) {
  const entries = run("tar", ["-tzf", tarball]).split("\n").filter(Boolean);
  const manifest = JSON.parse(run("tar", ["-xzOf", tarball, "package/package.json"]));
  return { entries, manifest };
}

// The compiler options a consumer of each package uses. Next.js apps compile
// with skipLibCheck (next's own declarations do not type-check without it);
// the fixture's imports of our entries are still checked under --strict.
const SMOKE_TSC = {
  react: ["--lib", "es2022,dom,dom.iterable", "--skipLibCheck"],
  node: ["--lib", "es2022"],
};

// Peers and type packages the smoke install needs, at the versions the workspace uses.
const SMOKE_EXTRAS = {
  react: ["react", "react-dom", "next", "typescript", "@types/react", "@types/node"],
  node: ["typescript", "@types/node"],
};

// Entries that only load inside a bundler. `@userbox/react/nextjs` imports
// `next/server`, which Next.js resolves at build time but plain Node ESM does
// not (no `exports` map in `next`). The smoke resolves these entries instead
// of importing them, and type-checks them with bundler resolution only.
const BUNDLER_ONLY = {
  react: ["./nextjs"],
  node: [],
};

function workspaceVersion(pkg, dep) {
  const path = join(ROOT, pkg, "node_modules", dep, "package.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")).version;
  } catch {
    fail(`${pkg}: cannot find ${dep} in the workspace; run pnpm install first`);
  }
}

function typecheck(dir, file, specifiers, resolution) {
  const fixture = specifiers.map((s, i) => `import * as m${i} from ${JSON.stringify(s)};\nvoid m${i};`).join("\n");
  writeFileSync(join(dir, file), fixture + "\n");
  run(join(dir, "node_modules", ".bin", "tsc"), ["--noEmit", "--strict", "--jsx", "react-jsx", ...resolution, file], {
    cwd: dir,
  });
}

// Import every `exports` entry of the installed package (and `require` the
// CommonJS ones; bundler-only entries are resolved, not imported), then
// type-check a fixture as a bundler consumer and as a Node ESM consumer.
// `dir` holds node_modules with the package, typescript and the type packages.
// Shared with verify-published.mjs, which runs it on the registry install.
export function checkEntries(pkg, dir, manifest) {
  const subpaths = Object.keys(manifest.exports).filter((k) => k !== "./package.json");
  const specifiers = subpaths.map((k) => manifest.name + k.slice(1));
  for (const spec of specifiers) {
    const subpath = `.${spec.slice(manifest.name.length)}`;
    const load = BUNDLER_ONLY[pkg].includes(subpath)
      ? `import.meta.resolve(${JSON.stringify(spec)});`
      : `await import(${JSON.stringify(spec)});`;
    run("node", ["--input-type=module", "-e", load], { cwd: dir });
    const entry = manifest.exports[subpath];
    if (entry && typeof entry === "object" && entry.require) {
      run("node", ["-e", `require(${JSON.stringify(spec)});`], { cwd: dir });
    }
  }

  // Type-check every entry as a bundler consumer would, and the entries
  // that load in plain Node as a Node ESM consumer would.
  const nodeSpecifiers = specifiers.filter((s) => !BUNDLER_ONLY[pkg].includes(`.${s.slice(manifest.name.length)}`));
  const lib = SMOKE_TSC[pkg];
  typecheck(dir, "bundler.ts", specifiers, [...lib, "--module", "esnext", "--moduleResolution", "bundler"]);
  typecheck(dir, "nodenext.ts", nodeSpecifiers, [...lib, "--module", "nodenext", "--moduleResolution", "nodenext"]);
}

function smoke(pkg, tarball, manifest) {
  const dir = mkdtempSync(join(tmpdir(), `check-pack-${pkg}-`));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
    const extras = SMOKE_EXTRAS[pkg].map((d) => `${d}@${workspaceVersion(pkg, d)}`);
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", resolve(tarball), ...extras], { cwd: dir });

    const installed = join(dir, "node_modules", ...manifest.name.split("/"));
    const stat = lstatSync(installed);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${pkg}: ${installed} is not a real directory`);

    checkEntries(pkg, dir, manifest);
  } catch (err) {
    if (err instanceof CheckError) throw err;
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    fail(`${pkg}: install-from-tarball smoke failed: ${err.message}${detail ? `\n${detail}` : ""}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packDir = args.tarball ? null : mkdtempSync(join(tmpdir(), "check-pack-tgz-"));
  try {
    for (const pkg of args.packages) {
      const tarball = args.tarball ?? pack(pkg, packDir);
      const { entries, manifest } = readTarball(tarball);
      checkContents(pkg, entries, manifest);
      checkManifest(pkg, manifest);
      if (args.smoke) smoke(pkg, tarball, manifest);
      console.log(`check-pack: ${pkg}: ok (${entries.length} entries${args.smoke ? ", smoke passed" : ""})`);
    }
  } finally {
    if (packDir) rmSync(packDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof CheckError)) throw err;
    console.error(`check-pack: ${err.message}`);
    process.exit(1);
  }
}
