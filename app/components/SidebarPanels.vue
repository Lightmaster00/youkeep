<template>
  <div class="sidebar-panels">
    <div
      v-for="group in groups"
      :key="group.id"
      class="sidebar-group"
      :class="{ 'is-off': !group.enabled, 'is-open': openId === group.id }"
    >
      <button
        :id="`sidebar-panel-header-${group.id}`"
        type="button"
        class="sidebar-panel-header"
        :aria-expanded="openId === group.id ? 'true' : 'false'"
        :aria-controls="`sidebar-panel-${group.id}`"
        :title="group.label"
        @click="toggle(group.id)"
      >
        <i class="sidebar-link-icon" v-html="group.icon"></i>
        <span class="sidebar-divider-title">
          {{ group.label }}
          <span v-if="!group.enabled" class="badge badge-failed">Off</span>
        </span>
        <svg class="sidebar-panel-chevron" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div
        :id="`sidebar-panel-${group.id}`"
        role="region"
        :aria-labelledby="`sidebar-panel-header-${group.id}`"
        class="sidebar-panel"
        :class="{ 'is-open': openId === group.id }"
        :inert="openId !== group.id"
      >
        <div class="sidebar-panel-inner">
          <NuxtLink
            v-for="link in group.links"
            :key="link.to"
            :to="link.to"
            class="sidebar-link"
            active-class="active"
          >
            <i class="sidebar-link-icon" v-html="link.icon"></i>
            <span>{{ link.label }}</span>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { resolveOpenPanel, type ManualPanelChoice, type SidebarGroup } from '~/utils/sidebarGroups';

const props = defineProps<{ groups: SidebarGroup[]; activeSpaceId: string }>();

const STORAGE_KEY = 'youkeep:sidebar-panel';

// The last panel choice made by hand; it only applies while the route stays in
// the space it was made in.
const manual = ref<ManualPanelChoice | undefined>(undefined);

const openId = computed(() =>
  resolveOpenPanel({ activeSpaceId: props.activeSpaceId, manual: manual.value, groupIds: props.groups.map((g) => g.id) })
);

function save(choice: ManualPanelChoice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch (e) {
    // Storage unavailable: the choice still applies for this page view.
  }
}

function forget() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Storage unavailable: nothing to forget.
  }
}

function load(): ManualPanelChoice | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const idOk = parsed?.id === null || typeof parsed?.id === 'string';
    if (!idOk || typeof parsed?.spaceId !== 'string') return undefined;
    return { id: parsed.id, spaceId: parsed.spaceId };
  } catch (e) {
    return undefined;
  }
}

function toggle(id: string) {
  const choice = { id: openId.value === id ? null : id, spaceId: props.activeSpaceId };
  manual.value = choice;
  save(choice);
}

// A stored choice is restored only if it was made in the current route space.
onMounted(() => {
  const stored = load();
  if (!stored) return;
  if (stored.spaceId === props.activeSpaceId) manual.value = stored;
  else forget();
});

// Moving to another space drops the manual choice so the new space opens.
watch(() => props.activeSpaceId, (spaceId) => {
  if (manual.value && manual.value.spaceId !== spaceId) {
    manual.value = undefined;
    forget();
  }
});
</script>

<style scoped>
.sidebar-panels {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-group + .sidebar-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-group.is-off {
  opacity: 0.5;
}

.sidebar-panel-header {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-radius: var(--border-radius-md);
  background: none;
  color: var(--text-muted);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.sidebar-panel-header:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.sidebar-panel-header:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: -2px;
}

.sidebar-group.is-open .sidebar-panel-header {
  color: var(--text-primary);
}

.sidebar-panel-header svg {
  flex-shrink: 0;
}

.sidebar-link-icon {
  display: inline-flex;
  flex-shrink: 0;
}

.sidebar-divider-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.sidebar-panel-chevron {
  opacity: 0;
  transition: opacity 0.15s ease, transform var(--duration-base) var(--ease-standard);
}

.sidebar-group.is-open .sidebar-panel-chevron {
  transform: rotate(180deg);
}

.sidebar-inner:hover .sidebar-divider-title,
.sidebar-inner:hover .sidebar-panel-chevron {
  opacity: 1;
}

/* Height animation: the grid row goes from 0fr (closed) to 1fr (open). */
.sidebar-panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-base) var(--ease-standard);
}

.sidebar-panel.is-open {
  grid-template-rows: 1fr;
}

.sidebar-panel-inner {
  min-height: 0;
  overflow: hidden;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  font-size: 14.5px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  margin-bottom: 2px;
  white-space: nowrap;
}

.sidebar-link svg {
  flex-shrink: 0;
}

.sidebar-link span {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.sidebar-inner:hover .sidebar-link span {
  opacity: 1;
}

.sidebar-link:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  transform: translateX(4px);
}

.sidebar-link.active {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-weight: 600;
}

.sidebar-link.active svg {
  color: white;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-panel,
  .sidebar-panel-chevron {
    transition: none;
  }
}

@media (max-width: 768px) {
  .sidebar-divider-title,
  .sidebar-panel-chevron,
  .sidebar-link span {
    display: none;
  }
  .sidebar-panel-header {
    justify-content: center;
    padding: 12px 0;
  }
  .sidebar-link {
    justify-content: center;
    padding: 12px 0;
    border-left: none;
    border-bottom: 2px solid transparent;
  }
  .sidebar-link.active {
    border-bottom-color: var(--accent-primary);
  }
}
</style>
