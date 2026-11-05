import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The CLI login is a normal tenant-admin session: a 15-minute access token and
// a single-use refresh token, rotated on every refresh. Both live in one file,
// mode 600, in a mode-700 directory. Nothing else is ever written there.

export interface Credentials {
  apiUrl: string;
  tenantSlug: string;
  tenantId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  accessExpiresAt: number;
}

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "userbox");
}

/** Where the login is stored; honours XDG_CONFIG_HOME. */
export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(readFileSync(credentialsPath(), "utf8")) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = credentialsPath();
  writeFileSync(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearCredentials(): void {
  rmSync(credentialsPath(), { force: true });
}
