import { isLanguageCode, type LanguageCode } from '#shared/languages';
import type { UserSession } from '~/composables/useAuth';

export function useUiLanguage() {
  const { locale, setLocale, t } = useI18n();
  const user = useState<UserSession | null>('auth_user');
  const toast = useToast();

  const current = computed<LanguageCode>(() => (isLanguageCode(locale.value) ? locale.value : 'en'));

  /** Switch now, save in the background; undo the switch when saving fails. */
  async function change(code: LanguageCode): Promise<boolean> {
    const previous = current.value;
    const previousSaved = user.value?.uiLanguage ?? null;
    await setLocale(code);
    if (user.value) user.value = { ...user.value, uiLanguage: code };
    try {
      await $fetch('/api/account/language', { method: 'PUT', body: { uiLanguage: code } });
      return true;
    } catch {
      if (user.value) user.value = { ...user.value, uiLanguage: previousSaved };
      await setLocale(previous);
      toast.error(t('language.saveFailed'));
      return false;
    }
  }

  return { current, change };
}
