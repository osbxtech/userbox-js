/**
 * Environment for the integration suite. Every test is skipped unless all
 * five variables are set; with USERBOX_INTEGRATION_REQUIRED=1 (CI) a missing
 * variable fails the run instead (global-setup.ts).
 *
 * Never log these values. Failures go through safe-assert.ts, which prints a
 * status and an error code only.
 */

export const API_URL = process.env.USERBOX_API_URL ?? "";
export const TENANT_SLUG = process.env.USERBOX_TEST_TENANT_SLUG ?? "";
export const USER_EMAIL = process.env.USERBOX_TEST_USER_EMAIL ?? "";
export const USER_PASSWORD = process.env.USERBOX_TEST_USER_PASSWORD ?? "";
export const API_KEY = process.env.USERBOX_TEST_API_KEY ?? "";

export const REQUIRED_ENV = [
  "USERBOX_API_URL",
  "USERBOX_TEST_TENANT_SLUG",
  "USERBOX_TEST_USER_EMAIL",
  "USERBOX_TEST_USER_PASSWORD",
  "USERBOX_TEST_API_KEY",
] as const;

export const integrationEnabled = REQUIRED_ENV.every((name) => Boolean(process.env[name]));
