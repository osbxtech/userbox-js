import { createInterface } from "node:readline";
import { Writable } from "node:stream";

import { CliError } from "./output.js";

/**
 * Interactive input exists only for a human at a terminal. Commands that need
 * a secret (the password) refuse to run without a TTY, so a coding agent
 * cannot type one and never sees it.
 */
export function requireTty(command: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      "NEEDS_HUMAN",
      `\`userbox ${command}\` must be run by a human in an interactive terminal`,
      `Ask the human to run \`npx @userbox/cli ${command}\` in their own terminal, then continue.`,
    );
  }
}

export async function ask(question: string, { secret = false, fallback = "" } = {}): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const label = fallback ? `${question} (${fallback}): ` : `${question}: `;
  try {
    return await new Promise<string>((resolve) => {
      rl.question(label, (answer) => {
        if (secret) process.stdout.write("\n");
        resolve(answer.trim() || fallback);
      });
      muted = secret;
    });
  } finally {
    rl.close();
  }
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} [y/N]`);
  return /^y(es)?$/i.test(answer);
}
