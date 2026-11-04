import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CliError } from "./output.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface NextProject {
  root: string;
  /** "app" or "src/app". */
  appDir: string;
  packageManager: PackageManager;
  nextVersion: string | null;
  typescript: boolean;
}

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

export function detectNextProject(root: string): NextProject {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    throw new CliError("NOT_A_PROJECT", `no package.json in ${root}`, "Run this in the root of your Next.js app.");
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next) {
    throw new CliError(
      "UNSUPPORTED_FRAMEWORK",
      "this is not a Next.js app (no `next` dependency)",
      "`userbox init` supports Next.js App Router only for now; see https://docs.test.userbox.app/llms.txt for other stacks.",
    );
  }
  const appDir = existsSync(join(root, "src", "app")) ? "src/app" : existsSync(join(root, "app")) ? "app" : null;
  if (!appDir) {
    throw new CliError(
      "UNSUPPORTED_FRAMEWORK",
      "no `app/` or `src/app/` directory: only the App Router is supported",
    );
  }
  return {
    root,
    appDir,
    packageManager: detectPackageManager(root),
    nextVersion: deps.next ?? null,
    typescript: existsSync(join(root, "tsconfig.json")),
  };
}

export function installCommand(pm: PackageManager, packages: string[]): [string, string[]] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", ["add", ...packages]];
    case "yarn":
      return ["yarn", ["add", ...packages]];
    case "bun":
      return ["bun", ["add", ...packages]];
    default:
      return ["npm", ["install", ...packages]];
  }
}
