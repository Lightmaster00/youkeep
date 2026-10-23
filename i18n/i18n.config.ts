import { frenchPlural } from './pluralRules';

export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  pluralRules: { fr: frenchPlural }
}));
