// Where a founder without an account creates one (Userbox feature 058).
// The CLI only prints the URL; it never creates an account and never sends a
// password to the sign-up flow.

const STATUS_TIMEOUT_MS = 2_000;

/** `https://api.<base>` → `https://auth.<base>/create-account`. */
export function deriveSignupUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const host = url.hostname.startsWith("api.") ? url.hostname.slice("api.".length) : url.hostname;
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//auth.${host}${port}/create-account`;
}

/**
 * Asks the API for its sign-up URL (`GET /v1/founder-signup/status`) and falls
 * back to {@link deriveSignupUrl} on any failure: timeout, network, non-200,
 * or a body without an http(s) `signup_url`.
 */
export async function resolveSignupUrl(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const fallback = deriveSignupUrl(apiUrl);
  try {
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/v1/founder-signup/status`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { signup_url?: unknown };
    if (typeof body.signup_url === "string" && /^https?:\/\//.test(body.signup_url)) return body.signup_url;
  } catch {
    // fall through to the derived URL
  }
  return fallback;
}
