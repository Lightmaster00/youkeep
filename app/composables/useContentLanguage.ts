import { isLanguageCode, type LanguageCode } from '#shared/languages';
import type { UserSession } from '~/composables/useAuth';

export type ContentLanguage = LanguageCode | 'original';

export function isContentLanguage(v: unknown): v is ContentLanguage {
  return v === 'original' || isLanguageCode(v);
}

/** Language of video titles and descriptions, separate from the interface language. */
export function useContentLanguage() {
  const { t } = useI18n();
  const user = useState<UserSession | null>('auth_user');
  const toast = useToast();
  const current = ref<ContentLanguage>(user.value?.contentLanguage ?? 'original');
  // null until the server answered; false = no YouTube Data API key, nothing can be fetched.
  const available = ref<boolean | null>(null);

  /** Client-side only (call from onMounted): reads the saved value and whether translations are possible. */
  async function load(): Promise<void> {
    try {
      const res = await $fetch<{ contentLanguage: ContentLanguage; available: boolean }>('/api/account/content-language');
      if (isContentLanguage(res.contentLanguage)) current.value = res.contentLanguage;
      available.value = !!res.available;
    } catch {
      // Keep the session value; the control stays usable and a save reports its own error.
    }
  }

  /** Save now (optimistic); put the previous value back and toast when saving fails. */
  async function change(value: ContentLanguage): Promise<boolean> {
    const previous = current.value;
    const previousSaved = user.value?.contentLanguage;
    current.value = value;
    if (user.value) user.value = { ...user.value, contentLanguage: value };
    try {
      const res = await $fetch<{ available: boolean }>('/api/account/content-language', { method: 'PUT', body: { contentLanguage: value } });
      available.value = !!res?.available;
    } catch {
      current.value = previous;
      if (user.value) user.value = { ...user.value, contentLanguage: previousSaved };
      toast.error(t('language.contentSaveFailed'));
      return false;
    }
    // Already-fetched video lists still hold the old text: reload them in place.
    try {
      await refreshNuxtData();
    } catch {
      // The next navigation fetches fresh data anyway.
    }
    return true;
  }

  return { current, available, load, change };
}
