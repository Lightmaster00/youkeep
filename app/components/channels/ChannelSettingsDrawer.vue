<template>
  <div>
    <!-- Backdrop Overlay for Drawer -->
    <div
      v-if="isAdmin"
      class="drawer-backdrop"
      :class="{ active: showDrawer }"
      @click="$emit('update:showDrawer', false)"
    ></div>

    <!-- Admin Settings Drawer -->
    <div
      v-if="isAdmin && channel"
      class="settings-drawer"
      :class="{ open: showDrawer }"
    >
      <div class="drawer-header">
        <h3 class="drawer-title">Tracking options</h3>
        <button class="drawer-close-btn" @click="$emit('update:showDrawer', false)">&times;</button>
      </div>

      <div class="drawer-body">
        <!-- Visibility -->
        <div class="form-group-item">
          <label class="form-label" style="margin-bottom: 8px; font-weight: 600;">Channel visibility:</label>
          <select :value="channel.visibility || 'public'" @change="handleUpdateChannelVisibility" class="form-input">
            <option value="public">🌍 Public (Everyone)</option>
            <option value="private">🔒 Private (Logged-in users)</option>
            <option value="ultra_private">🔑 Ultra Private (Admins only)</option>
          </select>
        </div>

        <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 8px 0;" />

        <!-- Archiving Preferences -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; color: white; margin: 0;">Archiving Preferences</h4>
          <form @submit.prevent="handleSavePreferences" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; gap: 24px;">
              <!-- Toggle switch Videos -->
              <label class="toggle-switch">
                <input type="checkbox" v-model="formPref.downloadVideos" class="toggle-input" />
                <div class="toggle-slider"></div>
                <span>Regular videos</span>
              </label>

              <!-- Toggle switch Shorts -->
              <label class="toggle-switch">
                <input type="checkbox" v-model="formPref.downloadShorts" class="toggle-input" />
                <div class="toggle-slider"></div>
                <span>Shorts</span>
              </label>
            </div>

            <!-- Custom save path -->
            <div class="pref-path-picker">
              <label class="form-label" for="drawerCustomSavePath" style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Custom save folder (leave empty for default):</label>
              <input
                type="text"
                id="drawerCustomSavePath"
                v-model="formPref.customSavePath"
                placeholder="/path/to/folder"
                class="form-input"
              />
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 8px;" :disabled="savingPref">
              <span v-if="savingPref" class="spinner-sm mr-2"></span>
              <span>Save preferences</span>
            </button>
          </form>
          <p v-if="prefMessage" class="pref-msg success-msg" style="text-align: center; color: #4ade80; font-size: 13px;">{{ prefMessage }}</p>
        </div>

        <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 8px 0;" />

        <!-- Supprimer -->
        <div style="margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 16px;">
          <button
            @click="handleDeleteChannel"
            class="btn critical-delete-btn btn-sm"
            style="width: 100%; justify-content: center;"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete from archive
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelsList } from '~/composables/useChannelsList';

defineProps<{ showDrawer: boolean }>();
defineEmits<{ 'update:showDrawer': [value: boolean] }>();

const { isAdmin } = useAuth();
const toast = useToast();
const router = useRouter();

const { channelId, channel, refreshSingleChannel } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();

const formPref = reactive({
  downloadVideos: true,
  downloadShorts: false,
  customSavePath: ''
});
const savingPref = ref(false);
const prefMessage = ref('');

// Populate preferences state when channel details load
let lastLoadedChannelId = '';

watch(channel, (newVal) => {
  if (newVal && newVal.id !== lastLoadedChannelId) {
    // Only populate formPref if the channel ID has changed, preventing polling resets
    lastLoadedChannelId = newVal.id;
    formPref.downloadVideos = newVal.download_videos === 1;
    formPref.downloadShorts = newVal.download_shorts === 1;
    formPref.customSavePath = newVal.custom_save_path || '';

    // date_after is deprecated
  }
}, { immediate: true });

const handleUpdateChannelVisibility = async (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/visibility`, {
      method: 'PUT',
      body: { visibility }
    });
    toast.success('Channel visibility updated.');
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const handleSavePreferences = async () => {
  savingPref.value = true;
  prefMessage.value = '';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/options`, {
      method: 'PUT',
      body: {
        downloadVideos: formPref.downloadVideos,
        downloadShorts: formPref.downloadShorts,
        dateAfter: null,
        customSavePath: formPref.customSavePath || null
      }
    });
    toast.success('Download options saved.');
    lastLoadedChannelId = ''; // Allow the watch handler to re-sync state on successful save refresh
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingPref.value = false;
  }
};

const handleDeleteChannel = async () => {
  if (!confirm(`WARNING: Are you sure you want to permanently delete the channel "${channel.value.title}" from the archive?\nThis will delete all downloaded videos from your disk and the database.`)) {
    return;
  }

  try {
    await $fetch(`/api/admin/channels/${channelId.value}`, { method: 'DELETE' });
    toast.success('Channel deleted.');
    router.push({ path: '/channels' });
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to delete the channel.');
  }
};
</script>
