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

    <!-- Home page -->
    <div class="pref-block">
      <div class="pref-head">
        <span class="form-label">Sections de l'accueil</span>
        <a v-if="isOverridden('homeSections')" href="#" class="reset-link" @click.prevent="resetKey('homeSections')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <div v-for="(row, index) in sectionRows" :key="row.id" class="section-row" :data-testid="`section-row-${row.id}`">
        <label class="check-row">
          <input type="checkbox" :checked="row.visible" :disabled="saving" @change="onSectionToggle(row.id, $event)" />
          <span>{{ SECTION_LABELS[row.id] }}</span>
        </label>
        <span class="move-buttons">
          <button type="button" class="move-btn" :data-testid="`up-${row.id}`" :disabled="saving || !row.visible || index === 0" aria-label="Monter" @click="moveSection(row.id, -1)">↑</button>
          <button type="button" class="move-btn" :data-testid="`down-${row.id}`" :disabled="saving || !row.visible || index === visibleCount - 1" aria-label="Descendre" @click="moveSection(row.id, 1)">↓</button>
        </span>
      </div>
      <p class="pref-hint">« Suggéré pour toi » et « Par chaîne suivie » ne s'affichent que pour les comptes connectés.</p>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <span class="form-label">Bloc vedette</span>
        <a v-if="isOverridden('homeHero')" href="#" class="reset-link" @click.prevent="resetKey('homeHero')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <label class="check-row">
        <input type="checkbox" data-testid="hero-toggle" :checked="shown.homeHero" :disabled="saving" @change="onHeroChange" />
        <span>Afficher le grand bloc en haut de l'accueil</span>
      </label>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-ranking`">Classement de « Populaires »</label>
        <a v-if="isOverridden('popularRanking')" href="#" class="reset-link" @click.prevent="resetKey('popularRanking')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-ranking`" class="form-input" :value="shown.popularRanking" :disabled="saving" @change="onRankingChange">
        <option v-for="opt in RANKING_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-rowsize`">Vidéos par rangée</label>
        <a v-if="isOverridden('rowSize')" href="#" class="reset-link" @click.prevent="resetKey('rowSize')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-rowsize`" class="form-input" :value="String(shown.rowSize)" :disabled="saving" @change="onNumberChange('rowSize', $event)">
        <option v-for="n in ROW_SIZES" :key="n" :value="String(n)">{{ n }}</option>
      </select>
    </div>

    <div class="pref-block">
      <div class="pref-head">
        <label class="form-label" :for="`${uid}-subchannels`">Chaînes suivies affichées</label>
        <a v-if="isOverridden('subscriptionChannels')" href="#" class="reset-link" @click.prevent="resetKey('subscriptionChannels')">Rétablir le défaut{{ mode === 'user' ? " de l'instance" : '' }}</a>
      </div>
      <select :id="`${uid}-subchannels`" class="form-input" :value="String(shown.subscriptionChannels)" :disabled="saving" @change="onNumberChange('subscriptionChannels', $event)">
        <option v-for="n in SUBSCRIPTION_CHANNEL_COUNTS" :key="n" :value="String(n)">{{ n }}</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useToast } from '~/composables/useToast';
import { HOME_SECTION_IDS, ROW_SIZES, SUBSCRIPTION_CHANNEL_COUNTS } from '#shared/displayPrefs';
import type { DisplayPrefs, HomeSectionId, PrefKey } from '#shared/displayPrefs';

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

const SECTION_LABELS: Record<HomeSectionId, string> = {
  recent: 'Ajoutés récemment',
  popular: 'Populaires',
  suggested: 'Suggéré pour toi',
  subscriptions: 'Par chaîne suivie',
};
const RANKING_OPTIONS = [
  { value: 'localViewers', label: 'Spectateurs de l’instance' },
  { value: 'youtubeViews', label: 'Vues YouTube' },
  { value: 'trending7d', label: 'Tendance des 7 derniers jours' },
  { value: 'watchTime', label: 'Temps de visionnage cumulé' },
];

// Visible sections in their configured order, then the hidden ones.
const sectionRows = computed(() => {
  const visible = shown.value.homeSections;
  const hidden = HOME_SECTION_IDS.filter((id) => !visible.includes(id));
  return [
    ...visible.map((id) => ({ id, visible: true })),
    ...hidden.map((id) => ({ id, visible: false })),
  ];
});
const visibleCount = computed(() => shown.value.homeSections.length);

function moveSection(id: HomeSectionId, delta: number) {
  const list = [...shown.value.homeSections];
  const i = list.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  commit({ homeSections: list }, () => {});
}

function onSectionToggle(id: HomeSectionId, event: Event) {
  const el = event.target as HTMLInputElement;
  const list = shown.value.homeSections.filter((x) => x !== id);
  if (el.checked) list.push(id);
  commit({ homeSections: list }, () => { el.checked = shown.value.homeSections.includes(id); });
}

function onHeroChange(event: Event) {
  const el = event.target as HTMLInputElement;
  commit({ homeHero: el.checked }, () => { el.checked = shown.value.homeHero; });
}

function onRankingChange(event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ popularRanking: el.value }, () => { el.value = shown.value.popularRanking; });
}

function onNumberChange(key: 'rowSize' | 'subscriptionChannels', event: Event) {
  const el = event.target as HTMLSelectElement;
  commit({ [key]: Number(el.value) }, () => { el.value = String(shown.value[key]); });
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

.section-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.move-buttons {
  display: flex;
  gap: 6px;
}

.move-btn {
  min-width: 32px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15));
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.move-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
