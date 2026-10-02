import { computed } from 'vue';
import { spaces } from '~/spaces';
import type { ModuleId } from '~/utils/moduleRouting';

const ORDER: ModuleId[] = ['video', 'music', 'podcasts'];

export const useModules = () => {
  const modules = useState<Record<ModuleId, boolean>>('modules', () => ({ video: true, music: true, podcasts: true }));
  const loaded = useState<boolean>('modules_loaded', () => false);

  const enabledModules = computed(() => ORDER.filter((id) => modules.value[id]));

  const isEnabled = (id: string): boolean => modules.value[id as ModuleId] !== false;

  const firstEnabledHome = computed(() => {
    const space = spaces.find((s) => modules.value[s.id as ModuleId] !== false);
    return space?.homeRoute ?? '/';
  });

  // On any failure everything is treated as enabled, so a transient error can
  // never lock an admin out; the server-side gate is the real enforcement.
  const refresh = async () => {
    try {
      const data = await $fetch<Partial<Record<ModuleId, boolean>>>('/api/settings/modules');
      modules.value = {
        video: data?.video !== false,
        music: data?.music !== false,
        podcasts: data?.podcasts !== false,
      };
    } catch {
      modules.value = { video: true, music: true, podcasts: true };
    } finally {
      loaded.value = true;
    }
  };

  const ensureLoaded = async () => {
    if (!loaded.value) await refresh();
  };

  return { modules, enabledModules, isEnabled, firstEnabledHome, refresh, ensureLoaded };
};
