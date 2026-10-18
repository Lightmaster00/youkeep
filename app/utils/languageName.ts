// "fr" -> "French", "pt-BR" -> "Brazilian Portuguese"; the code itself when
// the runtime cannot name it (or it is not a language code at all).
let names: Intl.DisplayNames | null | undefined;

export function languageName(code: string | null | undefined): string {
  const value = (code || '').trim();
  if (!value) return '';
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });
    } catch {
      names = null;
    }
  }
  if (!names) return value;
  try {
    const label = names.of(value);
    return label && label !== value ? label : value;
  } catch {
    return value;
  }
}
