import { isLanguageCode } from '#shared/languages';
import type { UserSession } from '~/composables/useAuth';

/** Switch the UI to the signed-in user's saved language, when they have one. */
export function applyUserLanguage(nuxtApp: ReturnType<typeof useNuxtApp>) {
  const code = nuxtApp.runWithContext(() => useState<UserSession | null>('auth_user').value?.uiLanguage);
  if (isLanguageCode(code) && nuxtApp.$i18n.locale.value !== code) {
    return nuxtApp.$i18n.setLocale(code as Parameters<typeof nuxtApp.$i18n.setLocale>[0]);
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const user = useState<UserSession | null>('auth_user');
  watch(() => user.value?.uiLanguage, () => { applyUserLanguage(nuxtApp); }, { immediate: true });
});
