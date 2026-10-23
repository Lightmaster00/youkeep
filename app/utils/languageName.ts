// "fr" -> "French", "pt-BR" -> "Brazilian Portuguese" (named in the UI
// language when a locale is given); the code itself when the runtime cannot
// name it (or it is not a language code at all).
const namers = new Map<string, Intl.DisplayNames | null>();

function namerFor(locale: string): Intl.DisplayNames | null {
  if (!namers.has(locale)) {
    try {
      namers.set(locale, new Intl.DisplayNames(locale, { type: 'language', fallback: 'code' }));
    } catch {
      namers.set(locale, null);
    }
  }
  return namers.get(locale) ?? null;
}

export function languageName(code: string | null | undefined, locale: string = 'en'): string {
  const value = (code || '').trim();
  if (!value) return '';
  const names = namerFor(locale);
  if (!names) return value;
  try {
    const label = names.of(value);
    return label && label !== value ? label : value;
  } catch {
    return value;
  }
}
