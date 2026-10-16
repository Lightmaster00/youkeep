// Log hygiene: error messages from ofetch/undici include the full request URL,
// and some providers (YouTube Data API) take the API key as a query parameter.

const URL_WITH_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/gi;

/** Replaces the query string of every URL in `text`, and any of `secrets`, with [redacted]. */
export function redactUrls(text: string, secrets: Array<string | null | undefined> = []): string {
  let out = text.replace(URL_WITH_QUERY, '$1?[redacted]');
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/** A one-line, redacted description of an error, safe to log. */
export function describeErrorForLog(err: unknown, secrets: Array<string | null | undefined> = []): string {
  const e = err as { statusCode?: number; status?: number; statusMessage?: string; message?: string; name?: string } | null;
  const status = e?.statusCode ?? e?.status;
  const message = e?.message || e?.statusMessage || String(err);
  return redactUrls(`${status ? `${status} ` : ''}${e?.name && e.name !== 'Error' ? `${e.name}: ` : ''}${message}`, secrets);
}

const MASK = '••••';

/** Last 4 characters of a stored secret, only when it is long enough to reveal little. */
export function secretHint(value: string): string {
  return value.length >= 12 ? value.slice(-4) : '';
}

/** What a settings form shows in place of a stored secret. */
export function maskSecret(value: string): string {
  if (!value) return '';
  return MASK + secretHint(value);
}
