<template>
  <div class="layout-container">
    <!-- Top Header -->
    <header class="header">
      <div class="header-left">
        <NuxtLink to="/" class="logo">
          <span class="logo-you">You</span><span class="logo-keep">Keep</span>
        </NuxtLink>
      </div>

      <div class="header-center">
        <form role="search" class="search-form" @submit.prevent="handleSearch">
          <input
            type="text"
            v-model="searchQuery"
            :placeholder="searchPlaceholder(activeSpace.id)"
            class="search-input"
            aria-label="Search"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="header-search-listbox"
            :aria-expanded="showDropdown ? 'true' : 'false'"
            :aria-activedescendant="showDropdown && selectedIndex >= 0 ? `header-search-option-${selectedIndex}` : undefined"
            autocomplete="off"
            data-testid="header-search-input"
            @input="onSearchInput"
            @focus="onSearchFocus"
            @blur="onSearchBlur"
            @keydown="onSearchKeydown"
          />
          <button type="submit" class="search-btn" aria-label="Search" title="Search">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>

          <div v-show="showDropdown" class="search-dropdown">
            <div id="header-search-listbox" role="listbox" :aria-label="searchQuery.trim() ? 'Suggestions' : 'Recent searches'" data-testid="header-search-listbox">
              <div
                v-for="(item, index) in dropdownItems"
                :id="`header-search-option-${index}`"
                :key="`${item.label}-${index}`"
                role="option"
                :aria-selected="index === selectedIndex ? 'true' : 'false'"
                class="search-dropdown-item"
                :class="{ 'is-selected': index === selectedIndex }"
                @mousedown.prevent="selectDropdownItem(item.label)"
              >
                <span class="search-dropdown-label">{{ item.label }}</span>
                <span v-if="item.sublabel" class="search-dropdown-sublabel">{{ item.sublabel }}</span>
              </div>
            </div>
            <button
              v-if="searchQuery.trim().length === 0 && historyEntries.length > 0"
              type="button"
              tabindex="-1"
              class="search-dropdown-clear"
              @mousedown.prevent="onClearHistory"
            >
              Clear recent searches
            </button>
          </div>
        </form>
      </div>

      <div class="header-right">
        <div v-if="user" ref="userMenuEl" class="user-menu-wrapper" @keydown="onUserMenuKeydown">
          <button
            ref="userMenuBtn"
            type="button"
            class="user-menu"
            :class="{ 'is-active': dropdownOpen }"
            aria-haspopup="menu"
            :aria-expanded="dropdownOpen ? 'true' : 'false'"
            aria-controls="header-user-menu"
            :aria-label="`Account menu for ${user.username}`"
            data-testid="user-menu-button"
            @click.stop="toggleDropdown"
          >
            <span class="avatar-circle" aria-hidden="true">
              {{ user.username.charAt(0).toUpperCase() }}
            </span>
            <span class="username">{{ user.username }}</span>
            <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>

          <!-- Profile Dropdown Menu -->
          <div v-if="dropdownOpen" id="header-user-menu" ref="userMenuList" class="dropdown-menu" role="menu" aria-label="Account" data-testid="user-menu" @click.stop>
            <div class="dropdown-header" role="presentation">
              <p class="dp-username">{{ user.username }}</p>
              <span class="dp-role badge" :class="user.role === 'admin' ? 'badge-completed' : 'badge-pending'">
                {{ user.role }}
              </span>
            </div>
            <hr class="dropdown-divider" role="separator" />
            <NuxtLink to="/account" class="dropdown-item" role="menuitem" tabindex="-1" @click="closeDropdown()">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              Account
            </NuxtLink>
            <NuxtLink to="/settings" class="dropdown-item" role="menuitem" tabindex="-1" @click="closeDropdown()">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
              Settings
              <span
                v-if="isAdmin && activeDownloadCount > 0"
                class="sidebar-badge"
                style="margin-left: auto;"
                :title="pausedTotal > 0 ? `${pausedTotal} more waiting on paused sources` : undefined"
              >
                {{ activeDownloadCount }}
              </span>
            </NuxtLink>
            <p v-if="isAdmin && pausedTotal > 0" class="dropdown-note" role="presentation">+{{ pausedTotal }} waiting on paused sources</p>
            <button type="button" class="dropdown-item logout-btn" role="menuitem" tabindex="-1" @click="handleLogout">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              Log out
            </button>
          </div>
        </div>
        <NuxtLink v-else-if="!authLoading && route.path !== '/login'" :to="loginTarget" class="btn btn-primary header-login" data-testid="header-login">
          Log in
        </NuxtLink>
      </div>
    </header>

    <div class="main-wrapper">
      <!-- Sidebar Navigation -->
      <aside class="sidebar">
        <div class="sidebar-inner">
          <nav class="sidebar-nav" aria-label="Main">
            <SidebarPanels :groups="sidebarGroups" :active-space-id="activeSpace.id" />
          </nav>
        </div>
      </aside>

      <!-- Main Content Page slot -->
      <main class="content-area" :class="{ 'has-mini-player': !!currentTrack || !!currentEpisode }">
        <slot />
      </main>
    </div>

    <!-- Toast Notification Container -->
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" class="toast-notification" :class="`toast-${toast.type}`">
          <!-- Success SVG -->
          <svg v-if="toast.type === 'success'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <!-- Error SVG -->
          <svg v-else-if="toast.type === 'error'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <!-- Info SVG -->
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>{{ toast.message }}</span>
          <button @click="removeToast(toast.id)" class="toast-close-btn">&times;</button>
        </div>
      </TransitionGroup>
    </div>

    <MusicMiniPlayer />
    <PodcastMiniPlayer />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { useActiveMiniPlayer } from '~/composables/useActiveMiniPlayer';
import { useActiveCounts, startActiveCountsPolling } from '~/composables/useActiveCounts';
import { spaces } from '~/spaces';
import { searchPlaceholder } from '~/utils/searchPlaceholder';
import { resolveActiveSpaceId } from '~/utils/moduleRouting';
import { shouldApplyLanding } from '~/utils/displayPrefs';
import { buildSidebarGroups } from '~/utils/sidebarGroups';

const { user, isAdmin, logout, loading: authLoading } = useAuth();
const displayPrefs = useDisplayPrefs();
useHead({ htmlAttrs: { 'data-density': computed(() => displayPrefs.effective.value.density) } });
const { toasts, removeToast } = useToast();
const { currentTrack } = useMusicPlayer();
const { currentEpisode } = usePodcastPlayer();
const { restoreActiveType } = useActiveMiniPlayer();
const dropdownOpen = ref(false);
const searchQuery = ref('');
const { get: getSearchHistory, add: addSearchHistory, clear: clearSearchHistory } = useSearchHistory();
const { suggestions, fetchSuggestions } = useSearchSuggestions();

const searchFocused = ref(false);
const selectedIndex = ref(-1);
const historyEntries = ref<string[]>([]);

const dropdownItems = computed<{ label: string; sublabel: string }[]>(() => {
  if (searchQuery.value.trim().length === 0) {
    return historyEntries.value.map((term) => ({ label: term, sublabel: '' }));
  }
  return suggestions.value.map((s) => ({ label: s.title, sublabel: s.subtitle }));
});

const showDropdown = computed(() => {
  if (!searchFocused.value) return false;
  if (searchQuery.value.trim().length === 0) return historyEntries.value.length > 0;
  return searchQuery.value.trim().length >= 2 && dropdownItems.value.length > 0;
});

function refreshHistoryEntries() {
  historyEntries.value = getSearchHistory();
}

function onSearchInput() {
  searchFocused.value = true;
  selectedIndex.value = -1;
  const term = searchQuery.value;
  if (term.trim().length === 0) {
    refreshHistoryEntries();
  } else {
    fetchSuggestions(term, contentSearchMode.value as 'per_space' | 'global', activeSpace.value.id as 'video' | 'music' | 'podcasts', enabledModules.value);
  }
}

function onSearchFocus() {
  searchFocused.value = true;
  if (searchQuery.value.trim().length === 0) {
    refreshHistoryEntries();
  }
}

function onSearchBlur() {
  // Delay so a click on a dropdown item registers before the dropdown hides.
  setTimeout(() => {
    searchFocused.value = false;
    selectedIndex.value = -1;
  }, 150);
}

function selectDropdownItem(label: string) {
  searchQuery.value = label;
  searchFocused.value = false;
  selectedIndex.value = -1;
  handleSearch();
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!showDropdown.value || dropdownItems.value.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % dropdownItems.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = selectedIndex.value <= 0 ? dropdownItems.value.length - 1 : selectedIndex.value - 1;
  } else if (e.key === 'Escape') {
    searchFocused.value = false;
    selectedIndex.value = -1;
  } else if (e.key === 'Enter' && selectedIndex.value >= 0) {
    e.preventDefault();
    selectDropdownItem(dropdownItems.value[selectedIndex.value]!.label);
  }
}

function onClearHistory() {
  clearSearchHistory();
  refreshHistoryEntries();
}

const router = useRouter();
const route = useRoute();
const { enabledModules, refresh: refreshModules } = useModules();
const activeSpace = computed(() => {
  const id = resolveActiveSpaceId(route.path, isAdmin.value, enabledModules.value);
  return spaces.find((s) => s.id === id) ?? spaces[0]!;
});

// One sidebar: every space is an accordion panel (SidebarPanels). Disabled modules
// are hidden from users and shown dimmed (Off) to admins; hidden-link prefs apply
// to the Video group.
const sidebarGroups = computed(() =>
  buildSidebarGroups(spaces, {
    isAdmin: isAdmin.value,
    enabled: enabledModules.value,
    hiddenNavLinks: displayPrefs.effective.value.hiddenNavLinks,
    mustChangePassword: !!user.value?.mustChangePassword,
    isGuest: !user.value,
  })
);

// Fill search query on mount if present in URL
onMounted(() => {
  if (route.query.q) {
    searchQuery.value = String(route.query.q);
  }
  checkPasswordEnforcement();
  // Runs after both mini-players' own onMounted restores (Vue mounts children
  // before parents), so by now each player has kicked off its own restore.
  restoreActiveType();
  fetchContentSearchMode();
});

const checkPasswordEnforcement = () => {
  if (user.value?.mustChangePassword && route.path !== '/account') {
    navigateTo('/account');
  }
};

watch([user, () => route.path], () => {
  checkPasswordEnforcement();
});

watch(() => route.query.q, (newVal) => {
  searchQuery.value = newVal ? String(newVal) : '';
});

// Header account menu: a real button + role="menu", operable with the
// keyboard (Enter/Space/ArrowDown open it on the first item, ArrowUp on the
// last, arrows/Home/End move, Escape closes and returns to the button, Tab
// leaves it).
const userMenuEl = ref<HTMLElement | null>(null);
const userMenuBtn = ref<HTMLButtonElement | null>(null);
const userMenuList = ref<HTMLElement | null>(null);

const menuItems = () => Array.from(userMenuList.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

async function openDropdown(focus: 'first' | 'last' | null) {
  dropdownOpen.value = true;
  if (!focus) return;
  await nextTick();
  const items = menuItems();
  (focus === 'first' ? items[0] : items[items.length - 1])?.focus();
}

const toggleDropdown = (e?: MouseEvent) => {
  if (dropdownOpen.value) {
    closeDropdown();
    return;
  }
  // A keyboard "click" (Enter/Space: detail 0) lands on the first item.
  openDropdown(e && e.detail === 0 ? 'first' : null);
};

// Close dropdown if clicked outside
const closeDropdown = (refocus = false) => {
  const wasOpen = dropdownOpen.value;
  dropdownOpen.value = false;
  if (refocus && wasOpen) userMenuBtn.value?.focus();
};

function onUserMenuKeydown(e: KeyboardEvent) {
  const onButton = e.target === userMenuBtn.value;
  if (e.key === 'Escape') {
    if (dropdownOpen.value) {
      e.preventDefault();
      closeDropdown(true);
    }
    return;
  }
  if (e.key === 'Tab') {
    closeDropdown();
    return;
  }
  if (!dropdownOpen.value) {
    if (onButton && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openDropdown(e.key === 'ArrowDown' ? 'first' : 'last');
    }
    return;
  }
  const items = menuItems();
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else if (e.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next >= 0) {
    e.preventDefault();
    items[next]!.focus();
  }
}

// Guests: a visible way in, back to this page afterwards.
const loginTarget = computed(() => ({ path: '/login', query: route.path === '/' ? {} : { redirect: route.fullPath } }));
const closeDropdownOnOutsideClick = () => closeDropdown();
onMounted(() => {
  window.addEventListener('click', closeDropdownOnOutsideClick);
});
onUnmounted(() => {
  window.removeEventListener('click', closeDropdownOnOutsideClick);
});

const contentSearchMode = ref('per_space');

async function fetchContentSearchMode() {
  try {
    const data = await $fetch<{ mode: string }>('/api/settings/content-search-mode');
    contentSearchMode.value = data.mode === 'global' ? 'global' : 'per_space';
  } catch (e) {
    contentSearchMode.value = 'per_space';
  }
}

const handleSearch = () => {
  const term = searchQuery.value.trim();
  if (term) {
    addSearchHistory(term);
  }
  if (contentSearchMode.value === 'global') {
    router.push({ path: '/search', query: { q: term || undefined } });
    return;
  }
  router.push({ path: activeSpace.value.homeRoute, query: { ...route.query, q: term || undefined, page: undefined, artistId: undefined, showId: undefined } });
};

// Downloading + queued (pickable) items, from the one shared poll of the
// active counts (also read by Settings); items of paused sources apart.
const { counts: activeCounts, pausedTotal } = useActiveCounts();
const activeDownloadCount = computed(() => activeCounts.value?.total || 0);
let releaseActiveCounts: (() => void) | null = null;

watch(isAdmin, (admin) => {
  if (!import.meta.client) return;
  if (admin && !releaseActiveCounts) releaseActiveCounts = startActiveCountsPolling();
  if (!admin && releaseActiveCounts) {
    releaseActiveCounts();
    releaseActiveCounts = null;
  }
});

const handleLogout = async () => {
  await logout();
};

onMounted(() => {
  if (isAdmin.value) releaseActiveCounts = startActiveCountsPolling();
  refreshModules();
  if (shouldApplyLanding(route.path, route.query)) {
    useLanding().consumeLandingTarget().then((target) => {
      if (target) router.replace(target);
    });
  }
});

onUnmounted(() => {
  releaseActiveCounts?.();
  releaseActiveCounts = null;
});
</script>

<style scoped>
.layout-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 100;
  background: rgba(10, 10, 15, 0.7);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.header-left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.header-center {
  display: flex;
  justify-content: center;
  flex: 1 1 auto;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  font-family: var(--font-title);
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.logo-you {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 800;
}

.logo-keep {
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(4px);
  padding: 1px 7px;
  border-radius: 8px;
  margin-left: 4px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15);
}

.search-form {
  display: flex;
  width: 500px;
  max-width: 100%;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-right: none;
  padding: 10px 20px;
  border-radius: 40px 0 0 40px;
  font-size: 14.5px;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.search-input:focus {
  border-color: var(--accent-primary);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px var(--accent-primary), 0 0 15px rgba(139, 92, 246, 0.15);
}

.search-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0 20px;
  border-radius: 0 40px 40px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: background 0.2s;
  color: var(--text-secondary);
}

.search-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.search-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.search-form {
  position: relative;
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  overflow: hidden;
  z-index: 50;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.search-dropdown-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
}

.search-dropdown-item:hover,
.search-dropdown-item.is-selected {
  background: rgba(255, 255, 255, 0.06);
}

.search-dropdown-label {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-dropdown-sublabel {
  color: var(--text-secondary);
  font-size: 12.5px;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-dropdown-clear {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--accent-primary);
  cursor: pointer;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.search-dropdown-clear:hover {
  background: rgba(255, 255, 255, 0.04);
}

.user-menu-wrapper {
  position: relative;
  min-width: 0;
}

.header-login {
  padding: 8px 18px;
  font-size: 14px;
}

.dropdown-note {
  margin: 0;
  padding: 0 20px 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.user-menu:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.user-menu {
  position: relative;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 6px 14px 6px 6px;
  border-radius: 40px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  max-width: 100%;
  min-width: 0;
}

.user-menu:hover, .user-menu.is-active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15);
  transform: translateY(-1px);
}

.avatar-circle {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: var(--font-title);
  font-size: 15px;
  box-shadow: 0 2px 10px var(--accent-primary-glow);
  border: 2px solid rgba(255, 255, 255, 0.1);
  transition: transform 0.3s ease, border-color 0.3s ease;
}

.user-menu:hover .avatar-circle, .user-menu.is-active .avatar-circle {
  transform: scale(1.05);
  border-color: rgba(255, 255, 255, 0.3);
}

.username {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dropdown-arrow {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), color 0.3s ease;
}

.user-menu.is-active .dropdown-arrow {
  transform: rotate(180deg);
  color: var(--accent-primary-hover);
}

.dropdown-menu {
  position: absolute;
  top: 54px;
  right: 0;
  width: 250px;
  border-radius: var(--border-radius-md);
  padding: 12px 0;
  background: rgba(22, 22, 30, 0.96);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  animation: fadeIn 0.15s ease-out;
  z-index: 1000;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.dropdown-header {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dp-username {
  font-weight: 600;
  font-size: 15px;
}

.dp-role {
  align-self: flex-start;
}

.dropdown-divider {
  border: 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 8px 0;
}

.dropdown-item {
  width: 100%;
  background: none;
  border: none;
  text-align: left;
  font-family: inherit;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.dropdown-item:focus-visible {
  outline: none;
  background: rgba(139, 92, 246, 0.15);
  color: var(--text-primary);
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.logout-btn {
  color: #ef4444;
}

.logout-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
}

.main-wrapper {
  display: flex;
  flex: 1;
  margin-top: var(--header-height);
  height: calc(100vh - var(--header-height));
  overflow: hidden;
}

.sidebar {
  width: var(--sidebar-collapsed-width);
  flex-shrink: 0;
  position: relative;
}

.sidebar-inner {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--sidebar-collapsed-width);
  height: 100%;
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width var(--duration-base) var(--ease-standard), background-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard);
  z-index: 50;
}

.sidebar-inner:hover {
  width: var(--sidebar-width);
  overflow-y: auto;
  background-color: rgba(28, 24, 38, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
}

.content-area {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 24px;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
}

.content-area.has-mini-player {
  padding-bottom: 96px;
}

@media (max-width: 768px) {
  .sidebar-inner:hover {
    width: var(--sidebar-collapsed-width);
    background-color: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: none;
  }
  .search-form {
    width: 200px;
  }
  /* The input is narrow here: the suggestions use the width of the screen. */
  .search-dropdown {
    position: fixed;
    top: calc(var(--header-height) - 4px);
    left: 8px;
    right: 8px;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 0 12px;
  }
  .username {
    display: none;
  }
}

@media (max-width: 340px) {
  .header-center {
    display: none;
  }
}

.sidebar-badge {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  min-width: 20px;
  max-width: 90px;
  text-align: center;
  margin-left: auto;
  box-shadow: 0 2px 6px var(--accent-primary-glow);
  animation: pulseBadge 2s ease-in-out infinite;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

@keyframes pulseBadge {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Global Toasts Styles */
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 2000;
  pointer-events: none;
}

.toast-notification {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border-radius: var(--border-radius-md);
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  max-width: 400px;
}

.toast-success {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
  backdrop-filter: blur(12px);
}

.toast-error {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
  backdrop-filter: blur(12px);
}

.toast-info {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #60a5fa;
  backdrop-filter: blur(12px);
}

.toast-close-btn {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  margin-left: auto;
  padding: 0;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.toast-close-btn:hover {
  opacity: 1;
}

.toast-enter-active {
  animation: toastIn 0.3s ease-out;
}

.toast-leave-active {
  animation: toastOut 0.25s ease-in;
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes toastOut {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
}
</style>
