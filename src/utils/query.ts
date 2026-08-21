/**
 * Build a URL query string from a params object.
 *
 * React Native's `URLSearchParams` polyfill is incomplete — `.set()`/`.get()`
 * throw "URLSearchParams.set is not implemented" at runtime — so we build the
 * string manually here. Null / undefined / empty-string values are skipped.
 * Returns the query WITHOUT a leading "?".
 *
 *   toQueryString({limit: 20, search: 'a b'}) // "limit=20&search=a%20b"
 */
export function toQueryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }
  return parts.join('&');
}
