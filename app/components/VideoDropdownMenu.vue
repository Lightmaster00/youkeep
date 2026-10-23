<template>
  <div v-if="hasActions" class="video-dropdown-container" @click.stop @keydown.esc="closeMenu(true)">
    <button
      ref="toggleEl"
      type="button"
      class="btn-dropdown-toggle"
      :aria-label="t('common.moreOptions')"
      aria-haspopup="menu"
      :aria-expanded="isOpen ? 'true' : 'false'"
      @click.stop="toggleMenu"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>
    </button>

    <transition name="dropdown-fade">
      <div v-if="isOpen" class="dropdown-menu glass-panel" role="menu">
        <button v-if="isLoggedIn" type="button" role="menuitem" class="dropdown-item" @click="openPlaylistModal">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="15" y1="10" x2="9" y2="10"/></svg>
          {{ t('common.save') }}
        </button>
        <button v-if="video?.local_video_path" type="button" role="menuitem" class="dropdown-item" @click="downloadVideo">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ t('common.download') }}
        </button>
        <template v-if="isLoggedIn">
          <div class="dropdown-divider" role="separator"></div>
          <button type="button" role="menuitem" class="dropdown-item text-danger" @click="openReport">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
            {{ t('common.report') }}
          </button>
        </template>
      </div>
    </transition>

    <!-- Out of the card (its overflow and transforms would clip a fixed overlay). -->
    <Teleport to="body">
      <SaveToPlaylistModal
        v-if="isLoggedIn"
        :show="isPlaylistModalOpen"
        :video-id="video.id"
        :video-title="video.title"
        @close="isPlaylistModalOpen = false"
      />
      <ReportVideoModal
        v-if="isLoggedIn"
        :show="isReportOpen"
        :video-id="video.id"
        @close="isReportOpen = false"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { useAuth } from '~/composables/useAuth';
import SaveToPlaylistModal from '~/components/SaveToPlaylistModal.vue';
import ReportVideoModal from '~/components/ReportVideoModal.vue';

const props = defineProps<{
  video: { id: string; title?: string; local_video_path?: string }
}>();

defineEmits(['hidden']);
const toast = useToast();
const { t } = useI18n();
const { isLoggedIn } = useAuth();

const isOpen = ref(false);
const isPlaylistModalOpen = ref(false);
const isReportOpen = ref(false);
const toggleEl = ref<HTMLButtonElement | null>(null);

// A guest without a downloadable file has nothing in this menu.
const hasActions = computed(() => isLoggedIn.value || !!props.video?.local_video_path);

const toggleMenu = () => {
  isOpen.value = !isOpen.value;
};

const closeMenu = (refocus = false) => {
  const wasOpen = isOpen.value;
  isOpen.value = false;
  if (refocus && wasOpen) toggleEl.value?.focus();
};

// Global click listener to close dropdown
const handleClickOutside = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.video-dropdown-container')) {
    closeMenu();
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

const downloadVideo = () => {
  closeMenu();
  if (props.video.local_video_path) {
    const a = document.createElement('a');
    a.href = props.video.local_video_path;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(t('video.downloadStarted'));
  } else {
    toast.error(t('video.downloadUnavailable'));
  }
};

const openReport = () => {
  closeMenu();
  isReportOpen.value = true;
};

const openPlaylistModal = () => {
  closeMenu();
  isPlaylistModalOpen.value = true;
};
</script>

<style scoped>
.video-dropdown-container {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
}

.btn-dropdown-toggle {
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: all 0.2s;
  opacity: 1; /* always visible */
}



.btn-dropdown-toggle:hover,
.btn-dropdown-toggle:focus {
  background: rgba(139, 92, 246, 0.8);
  border-color: rgba(139, 92, 246, 1);
  opacity: 1;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  width: 180px;
  background: rgba(20, 20, 35, 0.95);
  border-radius: 12px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.8);
  border: 1px solid rgba(255,255,255,0.08);
  transform-origin: top right;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(-5px);
}

.dropdown-item {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  width: 100%;
}

.dropdown-item svg {
  color: rgba(255, 255, 255, 0.5);
  transition: color 0.2s;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: white;
}

.dropdown-item:hover svg {
  color: white;
}

.dropdown-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 0;
}

.text-danger {
  color: #f87171 !important;
}
.text-danger svg {
  color: #f87171 !important;
}
.text-danger:hover {
  background: rgba(239, 68, 68, 0.15) !important;
  color: #fca5a5 !important;
}
</style>
