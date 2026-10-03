import { computed } from 'vue';
import { buildView } from '../../shared/displayPrefs';
import type { DisplayView } from '../../shared/displayPrefs';

export const useDisplayPrefs = () => {
  const auth = useAuth();
  const view = useState<DisplayView>('display_prefs', () => buildView({}, null));
  // Which user (id, or null for a guest) the state was loaded for; undefined = never loaded.
  const loadedFor = useState<string | null | undefined>('display_prefs_for', () => undefined);

  const effective = computed(() => view.value.effective);

  const refresh = async () => {
    const userId = auth.user.value?.id ?? null;
    // useRequestFetch forwards the caller's cookies during SSR (a plain $fetch would not),
    // and is the browser $fetch on the client.
    const requestFetch = useRequestFetch();
    try {
      view.value = await requestFetch<DisplayView>('/api/settings/display');
    } catch {
      view.value = buildView({}, null);
    } finally {
      loadedFor.value = userId;
    }
  };

  const ensureLoaded = async () => {
    if (loadedFor.value !== (auth.user.value?.id ?? null)) await refresh();
  };

  // Saves throw the $fetch error on failure (the caller shows it) and leave the state untouched.
  const saveOverrides = async (partial: Record<string, unknown>) => {
    const data = await $fetch<DisplayView>('/api/account/preferences', { method: 'PUT', body: partial });
    view.value = data;
    return data;
  };

  const saveAdminDefaults = async (partial: Record<string, unknown>) => {
    const data = await $fetch<DisplayView>('/api/admin/settings/display-defaults', { method: 'POST', body: partial });
    view.value = data;
    return data;
  };

  return { view, effective, ensureLoaded, refresh, saveOverrides, saveAdminDefaults };
};
