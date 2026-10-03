<template>
  <div class="layout-container">
    <!-- Top Header -->
    <header class="header">
      <div class="header-left">
        <NuxtLink to="/" class="logo">
          <span class="logo-you">You</span><span class="logo-keep">Keep</span>
        </NuxtLink>

        <div v-if="!user?.mustChangePassword" class="space-switcher" :class="{ 'is-active': spaceMenuOpen }" @click.stop="toggleSpaceMenu">
          <i class="space-switcher-icon" v-html="activeSpace.icon"></i>
          <span class="space-switcher-label">{{ activeSpace.label }}</span>
          <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>

          <div v-if="spaceMenuOpen" class="dropdown-menu space-menu" @click.stop>
            <div
              v-for="space in visibleSpaces"
              :key="space.id"
              class="dropdown-item space-menu-item"
              :class="{ active: space.id === activeSpace.id }"
              @click="selectSpace(space.homeRoute)"
            >
              <i class="space-switcher-icon" v-html="space.icon"></i>
              {{ space.label }}
              <span v-if="!isEnabled(space.id)" class="badge badge-failed" style="margin-left: auto;">Désactivé</span>
            </div>
          </div>
        </div>
      </div>

      <div class="header-center">
        <form @submit.prevent="handleSearch" class="search-form">
          <input
            type="text"
            v-model="searchQuery"
            placeholder="Search videos, channels..."
            class="search-input"
            @input="onSearchInput"
            @focus="onSearchFocus"
            @blur="onSearchBlur"
            @keydown="onSearchKeydown"
          />
          <button type="submit" class="search-btn">
            <!-- Search SVG -->
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>

          <div v-if="showDropdown" class="search-dropdown">
            <div
              v-for="(item, index) in dropdownItems"
              :key="`${item.label}-${index}`"
              class="search-dropdown-item"
              :class="{ 'is-selected': index === selectedIndex }"
              @mousedown.prevent="selectDropdownItem(item.label)"
            >
              <span class="search-dropdown-label">{{ item.label }}</span>
              <span v-if="item.sublabel" class="search-dropdown-sublabel">{{ item.sublabel }}</span>
            </div>
            <div
              v-if="searchQuery.trim().length === 0 && historyEntries.length > 0"
              class="search-dropdown-clear"
              @mousedown.prevent="onClearHistory"
            >
              Effacer
            </div>
          </div>
        </form>
      </div>

      <div class="header-right">
        <div v-if="user" class="user-menu" :class="{ 'is-active': dropdownOpen }" @click.stop="toggleDropdown">
          <div class="avatar-circle">
            {{ user.username.charAt(0).toUpperCase() }}
          </div>
          <span class="username">{{ user.username }}</span>
          <!-- Dropdown Arrow -->
          <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          
          <!-- Profile Dropdown Menu -->
          <div v-if="dropdownOpen" class="dropdown-menu" @click.stop>
            <div class="dropdown-header">
              <p class="dp-username">{{ user.username }}</p>
              <span class="dp-role badge" :class="user.role === 'admin' ? 'badge-completed' : 'badge-pending'">
                {{ user.role }}
              </span>
            </div>
            <hr class="dropdown-divider" />
            <NuxtLink to="/account" class="dropdown-item" @click="dropdownOpen = false">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              Account
            </NuxtLink>
            <NuxtLink to="/settings" class="dropdown-item" @click="dropdownOpen = false">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
              Settings
              <span v-if="activeDownloadCount > 0" class="sidebar-badge" style="margin-left: auto;">
                {{ activeDownloadCount }}
              </span>
            </NuxtLink>
            <button @click="handleLogout" class="dropdown-item logout-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              Log out
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="main-wrapper">
      <!-- Sidebar Navigation -->
      <aside class="sidebar">
        <div class="sidebar-inner">
          <nav class="sidebar-nav">
            <NuxtLink
              v-for="link in visibleNavLinks"
              v-show="!link.hideWhenMustChangePassword || !user?.mustChangePassword"
              :key="link.to"
              :to="link.to"
              class="sidebar-link"
              active-class="active"
            >
              <i class="sidebar-link-icon" v-html="link.icon"></i>
              <span>{{ link.label }}</span>
            </NuxtLink>
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePodcastPlayer } from '~/composables/usePodcastPlayer';
import { useActiveMiniPlayer } from '~/composables/useActiveMiniPlayer';
import { spaces } from '~/spaces';
import { resolveActiveSpaceId } from '~/utils/moduleRouting';
import { filterNavLinks } from '~/utils/displayPrefs';

const { user, isAdmin, logout } = useAuth();
const displayPrefs = useDisplayPrefs();
useHead({ htmlAttrs: { 'data-density': computed(() => displayPrefs.effective.value.density) } });
const { toasts, removeToast } = useToast();
const { currentTrack } = useMusicPlayer();
const { currentEpisode } = usePodcastPlayer();
const { restoreActiveType } = useActiveMiniPlayer();
const dropdownOpen = ref(false);
const spaceMenuOpen = ref(false);
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
const { enabledModules, isEnabled, refresh: refreshModules } = useModules();
const activeSpace = computed(() => {
  const id = resolveActiveSpaceId(route.path, isAdmin.value, enabledModules.value);
  return spaces.find((s) => s.id === id) ?? spaces[0]!;
});

// Navigation links the current user chose to show (Home and the library links are never hideable).
const visibleNavLinks = computed(() =>
  filterNavLinks(activeSpace.value.navLinks, displayPrefs.effective.value.hiddenNavLinks)
);

// Non-admins only see enabled modules; admins see all, disabled ones carry a badge.
const visibleSpaces = computed(() =>
  spaces.filter((s) => isAdmin.value || isEnabled(s.id))
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

const toggleDropdown = () => {
  dropdownOpen.value = !dropdownOpen.value;
  spaceMenuOpen.value = false;
};

const toggleSpaceMenu = () => {
  spaceMenuOpen.value = !spaceMenuOpen.value;
  dropdownOpen.value = false;
};

const selectSpace = (homeRoute: string) => {
  spaceMenuOpen.value = false;
  navigateTo(homeRoute);
};

// Close dropdown if clicked outside
const closeDropdown = () => {
  dropdownOpen.value = false;
  spaceMenuOpen.value = false;
};
onMounted(() => {
  window.addEventListener('click', closeDropdown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeDropdown);
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

const activeDownloadCount = ref(0);
const activeDownloadProgress = ref<number | null>(null);
const activeDownloadSpeed = ref<string | null>(null);
let downloadCountInterval: any = null;

const fetchActiveDownloads = async () => {
  if (!isAdmin.value) return;
  try {
    const data = await $fetch<any>('/api/admin/downloader/queue');
    const queue = data.queue || [];
    activeDownloadCount.value = queue.length;
    
    // Find the video currently being downloaded
    const downloadingVideo = queue.find((v: any) => v.download_status === 'downloading');
    if (downloadingVideo) {
      activeDownloadProgress.value = downloadingVideo.download_progress || 0;
      activeDownloadSpeed.value = downloadingVideo.download_speed || null;
    } else {
      activeDownloadProgress.value = null;
      activeDownloadSpeed.value = null;
    }
  } catch (e) {
    // Silently fail — not critical
  }
};

const handleLogout = async () => {
  await logout();
};

onMounted(() => {
  fetchActiveDownloads();
  downloadCountInterval = setInterval(fetchActiveDownloads, 5000);
  refreshModules();
  if (route.path === '/') {
    useLanding().consumeLandingTarget().then((target) => {
      if (target) router.replace(target);
    });
  }
});

onUnmounted(() => {
  if (downloadCountInterval) clearInterval(downloadCountInterval);
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

.space-switcher {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
  padding: 6px 14px 6px 10px;
  border-radius: 40px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.space-switcher:hover,
.space-switcher.is-active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.15);
}

.space-switcher.is-active .dropdown-arrow {
  transform: rotate(180deg);
  color: var(--accent-primary-hover);
}

.space-switcher-icon {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
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

.user-menu {
  position: relative;
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

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.space-menu {
  top: 44px;
  left: 0;
  right: auto;
  width: 200px;
}

.space-menu-item.active {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border-left: 2px solid var(--accent-primary);
  padding-left: 18px;
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
  gap: 4px;
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

.sidebar-divider-title {
  padding: 24px 24px 8px 24px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.1em;
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
  .sidebar-link span, .sidebar-divider-title {
    display: none;
  }
  .space-switcher-label {
    display: none;
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
  .search-form {
    width: 200px;
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
