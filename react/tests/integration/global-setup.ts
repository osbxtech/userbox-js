import { REQUIRED_ENV } from "./fixtures";

/**
 * In CI (USERBOX_INTEGRATION_REQUIRED=1) a missing variable must fail the run:
 * a silently skipped suite would look green. Only the names are printed.
 */
export default function setup(): void {
  if (process.env.USERBOX_INTEGRATION_REQUIRED !== "1") return;
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`integration: missing environment variables: ${missing.join(", ")}`);
  }
}
