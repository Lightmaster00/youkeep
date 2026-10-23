import { frenchPlural, noPlural, russianPlural } from './pluralRules';

export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  // es / de / it / en keep vue-i18n's default rule; pt (Brazil) counts 0 as singular like French.
  pluralRules: { fr: frenchPlural, pt: frenchPlural, zh: noPlural, ja: noPlural, ru: russianPlural }
}));
