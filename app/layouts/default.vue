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
        <form @submit.prevent="handleSearch" class="search-form">
          <input 
            type="text" 
            v-model="searchQuery" 
            placeholder="Search videos, channels..." 
            class="search-input"
          />
          <button type="submit" class="search-btn">
            <!-- Search SVG -->
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
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
        <nav class="sidebar-nav">
          <NuxtLink v-if="!user?.mustChangePassword" to="/" class="sidebar-link" active-class="active">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            <span>Home</span>
          </NuxtLink>

          <NuxtLink v-if="!user?.mustChangePassword" to="/shorts" class="sidebar-link" active-class="active">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
            <span>Shorts</span>
          </NuxtLink>

          <NuxtLink v-if="!user?.mustChangePassword" to="/channels" class="sidebar-link" active-class="active">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
            <span>Channels</span>
          </NuxtLink>

          <NuxtLink v-if="!user?.mustChangePassword" to="/subscriptions" class="sidebar-link" active-class="active">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            <span>Subscriptions</span>
          </NuxtLink>

          <NuxtLink v-if="!user?.mustChangePassword" to="/playlists" class="sidebar-link" active-class="active">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            <span>Playlists</span>
          </NuxtLink>
        </nav>
      </aside>

      <!-- Main Content Page slot -->
      <main class="content-area">
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

const { user, isAdmin, logout } = useAuth();
const { toasts, removeToast } = useToast();
const dropdownOpen = ref(false);
const searchQuery = ref('');
const router = useRouter();
const route = useRoute();

// Fill search query on mount if present in URL
onMounted(() => {
  if (route.query.q) {
    searchQuery.value = String(route.query.q);
  }
  checkPasswordEnforcement();
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
};

// Close dropdown if clicked outside
const closeDropdown = () => {
  dropdownOpen.value = false;
};
onMounted(() => {
  window.addEventListener('click', closeDropdown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeDropdown);
});

const handleSearch = () => {
  router.push({ path: '/', query: { ...route.query, q: searchQuery.value || undefined, page: undefined } });
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
}

.dropdown-arrow {
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
  width: var(--sidebar-width);
  background: transparent;
  border-right: 1px solid rgba(255, 255, 255, 0.03);
  padding: 20px 12px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
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

@media (max-width: 768px) {
  .sidebar {
    width: var(--sidebar-collapsed-width);
  }
  .sidebar-link span, .sidebar-divider-title {
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
