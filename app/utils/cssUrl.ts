// A CSS url() value for a data-driven address (thumbnail, banner). Unquoted
// url(${x}) breaks on spaces, parentheses or quotes in legacy paths and lets a
// stray ")" end the value early. The address is percent-encoded (without
// double-encoding what already is) and quoted.
export function cssUrl(raw: string | null | undefined): string {
  if (!raw) return 'none';
  let encoded: string;
  try {
    encoded = encodeURI(decodeURI(raw));
  } catch {
    encoded = encodeURI(raw);
  }
  // encodeURI leaves ( ) and ' alone; they are harmless inside a quoted
  // url("..."), and " and \ never survive encodeURI.
  return `url("${encoded}")`;
}
