// Every command prints for two readers: a human, or (with --json) a coding
// agent. Errors always carry a stable code and a hint that says what to do.

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export interface Output {
  json: boolean;
  /** A progress line for humans; silent in --json mode. */
  step(message: string): void;
  /** A warning; kept for the JSON result in --json mode. */
  warn(message: string): void;
  /** The final result: a JSON document, or the human summary lines. */
  done(result: Record<string, unknown>, lines: string[]): void;
}

export function createOutput(json: boolean): Output {
  const warnings: string[] = [];
  return {
    json,
    step(message) {
      if (!json) process.stdout.write(`  ${message}\n`);
    },
    warn(message) {
      warnings.push(message);
      if (!json) process.stderr.write(`  ! ${message}\n`);
    },
    done(result, lines) {
      if (json) {
        process.stdout.write(`${JSON.stringify({ ok: true, ...result, warnings }, null, 2)}\n`);
      } else {
        for (const line of lines) process.stdout.write(`${line}\n`);
      }
    },
  };
}

export function printError(err: unknown, json: boolean): void {
  const e =
    err instanceof CliError
      ? err
      : new CliError("UNEXPECTED", err instanceof Error ? err.message : String(err));
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: e.code, message: e.message, hint: e.hint ?? null } }, null, 2)}\n`,
    );
  } else {
    process.stderr.write(`error [${e.code}]: ${e.message}\n`);
    if (e.hint) process.stderr.write(`hint: ${e.hint}\n`);
  }
}
