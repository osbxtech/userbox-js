// Minimal .env reader/merger. It never rewrites or reorders existing lines:
// values already present win unless the caller forces a key, and new keys are
// appended in a block at the end.

export const ENV_KEYS = [
  "NEXT_PUBLIC_USERBOX_TENANT_SLUG",
  "NEXT_PUBLIC_USERBOX_API_URL",
  "USERBOX_TENANT_ID",
  "USERBOX_API_KEY",
  "APP_ORIGIN",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(m[1]!, value);
  }
  return out;
}

export interface MergeResult {
  text: string;
  added: string[];
  replaced: string[];
  kept: string[];
}

/**
 * Merge `values` into an existing .env text. A key that already has a
 * non-empty value is kept, unless it is listed in `force`; then its line is
 * replaced in place. Missing or empty keys are written.
 */
export function mergeEnv(
  existing: string,
  values: Record<string, string>,
  force: ReadonlySet<string> = new Set(),
): MergeResult {
  const current = parseEnv(existing);
  const added: string[] = [];
  const replaced: string[] = [];
  const kept: string[] = [];
  const lines = existing === "" ? [] : existing.replace(/\n$/, "").split(/\r?\n/);
  const toAppend: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const had = current.get(key);
    if (had && !force.has(key)) {
      kept.push(key);
      continue;
    }
    const idx = lines.findIndex((l) => LINE.exec(l)?.[1] === key);
    if (idx >= 0) {
      lines[idx] = `${key}=${value}`;
      (had ? replaced : added).push(key);
    } else {
      toAppend.push(`${key}=${value}`);
      added.push(key);
    }
  }

  if (toAppend.length > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# Userbox (written by `userbox init`)", ...toAppend);
  }
  return { text: lines.length ? `${lines.join("\n")}\n` : "", added, replaced, kept };
}
