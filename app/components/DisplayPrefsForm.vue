<template>
  <div class="display-prefs-form">
    <!-- Density -->
    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-density`">Densité des grilles</label>
        <a v-if="isOverridden('density')" href="#" class="reset-link" @click.prevent="resetKey('density')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-density`" class="form-input" :value="shown.density" :disabled="saving" @change="onDensityChange">
        <option value="compact">Compacte (plus de colonnes)</option>
        <option value="comfortable">Normale</option>
        <option value="spacious">Large (moins de colonnes)</option>
      </select>
    </div>

    <!-- Navigation -->
    <div class="pref-block">
      <div class="pref-head">
        <span class="form-label">Liens de navigation à masquer</span>
        <a v-if="isOverridden('hiddenNavLinks')" href="#" class="reset-link" @click.prevent="resetKey('hiddenNavLinks')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <label v-for="link in navOptions" :key="link.to" class="check-row">
        <input
          type="checkbox"
          :checked="shown.hiddenNavLinks.includes(link.to)"
          :disabled="saving"
          @change="onNavChange(link.to, $event)"
        />
        <span>{{ link.label }}</span>
      </label>
      <p class="pref-hint">L'accueil et les bibliothèques ne peuvent pas être masqués. Une page masquée reste accessible par son adresse.</p>
    </div>

    <!-- Landing space -->
    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-landing`">Espace affiché au démarrage</label>
        <a v-if="isOverridden('landingSpace')" href="#" class="reset-link" @click.prevent="resetKey('landingSpace')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-landing`" class="form-input" :value="shown.landingSpace" :disabled="saving" @change="onLandingChange">
        <option value="auto">Automatique (premier espace actif)</option>
        <option v-for="space in landingOptions" :key="space.id" :value="space.id">{{ space.label }}</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useToast } from '~/composables/useToast';
import type { DisplayPrefs, PrefKey } from '#shared/displayPrefs';

const props = defineProps<{ mode: 'user' | 'admin' }>();

const toast = useToast();
const { view, saveOverrides, saveAdminDefaults, refresh } = useDisplayPrefs();
const { enabledModules } = useModules();

const uid = `dpf-${props.mode}`;
const saving = ref(false);

// What the form shows: in user mode the effective values (personal choice or
// inherited default); in admin mode the instance defaults (app defaults + admin).
const shown = computed<DisplayPrefs>(() => (props.mode === 'user' ? view.value.effective : view.value.defaults));

// Whether this key is set at the level the form edits (so a "reset" makes sense).
const isOverridden = (key: PrefKey): boolean => {
  const level = props.mode === 'user' ? view.value.overrides : view.value.adminDefaults;
  return !!level && key in level;
};

const navOptions = [
  { to: '/shorts', label: 'Shorts' },
  { to: '/channels', label: 'Chaînes' },
  { to: '/subscriptions', label: 'Abonnements' },
  { to: '/playlists', label: 'Playlists' },
];

const SPACE_LABELS: Record<string, string> = { video: 'Vidéo', music: 'Musique', podcasts: 'Podcasts' };
const landingOptions = computed(() =>
  enabledModules.value.map((id) => ({ id, label: SPACE_LABELS[id] ?? id }))
);

const save = (partial: Record<string, unknown>) =>
  props.mode === 'user' ? saveOverrides(partial) : saveAdminDefaults(partial);

// Save, then ALWAYS force the DOM back to the reactive state (see the
// behavioural requirements): a refused or failed save leaves the control the
// browser already flipped out of sync with what the server holds.
async function commit(partial: Record<string, unknown>, resync: () => void) {
  saving.value = true;
  try {
    await save(partial);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || "Échec de l'enregistrement de l'affichage.");
    await refresh();
  } finally {
    saving.value = false;
    resync();
  }
}

function onDensityChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ density: el.value }, () => { el.value = shown.value.density; });
}

function onLandingChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ landingSpace: el.value }, () => { el.value = shown.value.landingSpace; });
}

function onNavChange(to: string, event: Event) {
  const el = event.target as HTMLInputElement;
  const current = new Set(shown.value.hiddenNavLinks);
  if (el.checked) current.add(to);
  else current.delete(to);
  // Keep the canonical order of the options so the stored array is stable.
  const next = navOptions.map((o) => o.to).filter((t) => current.has(t));
  commit({ hiddenNavLinks: next }, () => { el.checked = shown.value.hiddenNavLinks.includes(to); });
}

async function resetKey(key: PrefKey) {
  await commit({ [key]: null }, () => {});
}

</script>

<style scoped>
.display-prefs-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.pref-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pref-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.reset-link {
  font-size: 12.5px;
  color: var(--accent-primary);
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.pref-hint {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 2px 0 0;
}
</style>
