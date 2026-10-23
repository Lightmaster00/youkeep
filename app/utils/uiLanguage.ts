import { isLanguageCode, pickLanguage, type LanguageCode } from '#shared/languages';

/** UI language: the user's saved choice, else the cookie, else the browser's, else English. */
export function resolveUiLanguage(opts: { userLanguage?: string | null; cookie?: string | null; accept?: string | null }): LanguageCode {
  if (isLanguageCode(opts.userLanguage)) return opts.userLanguage;
  if (isLanguageCode(opts.cookie)) return opts.cookie;
  return pickLanguage(opts.accept);
}
