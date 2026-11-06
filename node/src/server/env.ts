import { UserboxConfigError } from "../errors";

/**
 * Environment variables the server helpers read when an option is omitted.
 * The names match the Userbox Next.js docs (`llms.txt`).
 */
export const ENV = {
  apiUrl: ["USERBOX_API_URL", "NEXT_PUBLIC_USERBOX_API_URL"],
  tenantId: ["USERBOX_TENANT_ID"],
  apiKey: ["USERBOX_API_KEY"],
} as const;

function readProcessEnv(name: string): string | undefined {
  // `process` is absent in some runtimes (edge, workers): treat as unset.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const value = env?.[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function fromEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = readProcessEnv(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Explicit option first, then the environment. Throws `CONFIG_ERROR` when neither is set. */
export function requireSetting(
  option: string | undefined,
  names: readonly string[],
  what: string,
): string {
  const value = option !== undefined && option.trim() !== "" ? option.trim() : fromEnv(names);
  if (value === undefined) {
    throw new UserboxConfigError({
      status: 0,
      code: "CONFIG_ERROR",
      message: `Missing ${what}: pass it as an option or set ${names.join(" or ")}`,
    });
  }
  return value;
}
