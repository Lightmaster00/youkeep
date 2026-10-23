import { isLanguageCode } from '#shared/languages';
import type { Ref } from 'vue';
import type { UserSession } from '~/composables/useAuth';

/** Switch the UI to the signed-in user's saved language, when they have one. */
export function applyUserLanguage(
  nuxtApp: ReturnType<typeof useNuxtApp>,
  // Pass the state when called outside a Nuxt context (runWithContext is async).
  user: Ref<UserSession | null> = useState<UserSession | null>('auth_user')
) {
  const code = user.value?.uiLanguage;
  if (isLanguageCode(code) && nuxtApp.$i18n.locale.value !== code) {
    return nuxtApp.$i18n.setLocale(code);
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const user = useState<UserSession | null>('auth_user');
  // i18n re-detects the locale (cookie / Accept-Language) on every navigation,
  // after our middleware has applied the saved one. Whenever a signed-in user
  // has a saved language it wins over detection, in every locale switch.
  nuxtApp.hook('i18n:beforeLocaleSwitch', (data: { newLocale: string }) => {
    const saved = user.value?.uiLanguage;
    if (isLanguageCode(saved)) data.newLocale = saved;
  });
  watch(() => user.value?.uiLanguage, () => { applyUserLanguage(nuxtApp, user); }, { immediate: true });
});
