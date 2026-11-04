import { parseArgs } from "node:util";

import { apply } from "./commands/apply.js";
import { devSeed } from "./commands/dev-seed.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { login, logout, whoami } from "./commands/login.js";
import { CliError, createOutput, printError } from "./output.js";

const VERSION = "0.1.0-alpha.0";

const HELP = `userbox — set up Userbox in your app

Usage: userbox <command> [options]

Commands
  login              Log in as a tenant admin (interactive, human only)
  logout             Forget the local login
  whoami             Show the current login
  init               Set up this Next.js app: env, API key, SDKs, auth files
  apply              Sync userbox.yaml (permissions and roles) to the environment
  dev seed           Create a dev workspace with an admin and a member user
  doctor             Check this app's Userbox setup

Options
  --json             Machine-readable output (for coding agents)
  --yes, -y          Apply without asking (apply)
  --force            init: replace existing USERBOX_* values in .env.local
  --origin <url>     init: the app origin (default http://localhost:3000)
  --skip-install     init: do not install the SDKs
  --api-url <url>    login: the Userbox API (default https://api.test.userbox.app)
  --invite <email[:role]>  dev seed: invite a user (repeatable, role defaults to member)
  --help, -h         Show this help
  --version, -v      Show the version

Docs: https://docs.test.userbox.app/llms.txt`;

export interface Flags {
  json: boolean;
  yes: boolean;
  force: boolean;
  origin?: string;
  skipInstall: boolean;
  apiUrl?: string;
  invite: string[];
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      force: { type: "boolean", default: false },
      origin: { type: "string" },
      "skip-install": { type: "boolean", default: false },
      "api-url": { type: "string" },
      invite: { type: "string", multiple: true, default: [] },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const flags: Flags = {
    json: values.json,
    yes: values.yes,
    force: values.force,
    origin: values.origin,
    skipInstall: values["skip-install"],
    apiUrl: values["api-url"],
    invite: values.invite,
  };
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const command = positionals.join(" ");
  if (values.help || command === "") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const out = createOutput(flags.json);
  try {
    switch (command) {
      case "login":
        await login(flags, out);
        break;
      case "logout":
        logout(out);
        break;
      case "whoami":
        await whoami(out);
        break;
      case "init":
        await init(flags, out);
        break;
      case "apply":
        await apply(flags, out);
        break;
      case "dev seed":
        await devSeed(flags, out);
        break;
      case "doctor":
        return await doctor(flags, out);
      default:
        throw new CliError("UNKNOWN_COMMAND", `unknown command "${command}"`, "Run `userbox --help`.");
    }
    return 0;
  } catch (err) {
    printError(err, flags.json);
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    printError(err, process.argv.includes("--json"));
    process.exit(1);
  },
);
