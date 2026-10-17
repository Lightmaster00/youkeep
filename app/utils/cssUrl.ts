// A CSS url() value for a data-driven address (thumbnail, banner). Unquoted
// url(${x}) breaks on spaces, parentheses or quotes in legacy paths and lets a
// stray ")" end the value early. The address is quoted, and every path
// segment is percent-encoded exactly once: the server already encodes its
// media paths per segment (a "#" arrives as "%23"), legacy values may be raw,
// and both must end up as the same canonical form.

function encodeSegment(segment: string): string {
  let plain = segment;
  try {
    plain = decodeURIComponent(segment);
  } catch {
    // A malformed escape ("%zz"): the "%" is literal.
  }
  return encodeURIComponent(plain);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

export function cssUrl(raw: string | null | undefined): string {
  if (!raw) return 'none';
  let encoded: string;
  const remote = /^(https?:)?\/\/[^/?#]*/i.exec(raw);
  if (remote) {
    // A remote address: the origin stays as is, the path is encoded per
    // segment, the query string and fragment belong to the remote server.
    const rest = raw.slice(remote[0].length);
    const cut = rest.search(/[?#]/);
    const path = cut === -1 ? rest : rest.slice(0, cut);
    const tail = cut === -1 ? '' : rest.slice(cut);
    let safeTail: string;
    try {
      safeTail = encodeURI(decodeURI(tail));
    } catch {
      safeTail = encodeURI(tail);
    }
    encoded = encodeURI(remote[0]) + encodePath(path) + safeTail;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    // data: and other schemes: no path segments to speak of.
    try {
      encoded = encodeURI(decodeURI(raw));
    } catch {
      encoded = encodeURI(raw);
    }
  } else {
    // A local path: every "?", "#" or "&" is part of a file name.
    encoded = encodePath(raw);
  }
  // Inside a quoted url("...") only " \ and line breaks could end or bend the
  // value; none of them survive the encoding above.
  return `url("${encoded}")`;
}
