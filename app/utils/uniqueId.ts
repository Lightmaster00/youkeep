let counter = 0;

// In-memory unique key for a component instance. crypto.randomUUID() is only
// defined in secure contexts (HTTPS / localhost), so it throws on a plain-HTTP
// LAN install; this works everywhere, on the server and in the browser.
export function nextInstanceId(prefix = 'inst'): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
