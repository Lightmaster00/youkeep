export const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'pt', 'it', 'zh', 'ja', 'ru'] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

/** Each language written in itself, for the selector. */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch', pt: 'Português',
  it: 'Italiano', zh: '中文', ja: '日本語', ru: 'Русский'
};

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

/** The best supported language for an Accept-Language header, else 'en'. */
export function pickLanguage(acceptLanguage: string | undefined | null): LanguageCode {
  if (!acceptLanguage) return 'en';
  const ranked = acceptLanguage.split(',').map((part, index) => {
    const [tag = '', ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const quality = q ? Number(q.slice(2)) : 1;
    return { primary: tag.trim().toLowerCase().split('-')[0] ?? '', quality: Number.isFinite(quality) ? quality : 0, index };
  }).sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { primary, quality } of ranked) {
    if (quality > 0 && isLanguageCode(primary)) return primary;
  }
  return 'en';
}
