<template>
  <BaseModal :show="!!channelId" :title="`Options for ${channelName}`" @close="$emit('close')">
    <p v-if="loading" class="section-desc">Loading...</p>
    <p v-else-if="loadError" class="settings-error-msg">Couldn't load this channel's options.</p>
    <form v-else class="channel-options-form" data-testid="channel-options-form" @submit.prevent="save">
      <span class="form-label">Download</span>
      <div class="channel-options-checks">
        <label class="checkbox-container"><input v-model="form.downloadVideos" type="checkbox" data-testid="opt-videos" /><span class="checkmark"></span>Videos</label>
        <label class="checkbox-container"><input v-model="form.downloadShorts" type="checkbox" data-testid="opt-shorts" /><span class="checkmark"></span>Shorts</label>
        <label class="checkbox-container"><input v-model="form.downloadLives" type="checkbox" data-testid="opt-lives" /><span class="checkmark"></span>Live recordings</label>
      </div>
      <p class="section-desc">Turning a type off also removes its videos that are still queued.</p>

      <div class="form-group">
        <label class="form-label" for="channel-opt-date">Only videos published after (optional)</label>
        <input id="channel-opt-date" v-model="form.dateAfter" type="date" class="form-input" data-testid="opt-date" />
      </div>

      <div class="form-group">
        <label class="form-label" for="channel-opt-folder">Save folder (leave empty for the default)</label>
        <input id="channel-opt-folder" v-model="form.customSavePath" type="text" class="form-input" data-testid="opt-folder" />
      </div>

      <div class="channel-options-actions">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving" data-testid="opt-save">{{ saving ? 'Saving...' : 'Save' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import BaseModal from '~/components/BaseModal.vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{ channelId: string | null; channelName: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const toast = useToast();
const loading = ref(false);
const loadError = ref(false);
const saving = ref(false);
const form = reactive({ downloadVideos: true, downloadShorts: false, downloadLives: false, dateAfter: '', customSavePath: '' });

function toInputDate(value: unknown): string {
  return typeof value === 'string' && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : '';
}

async function load(id: string) {
  loading.value = true;
  loadError.value = false;
  try {
    const data = await $fetch<any>(`/api/channels/${encodeURIComponent(id)}`);
    const c = data?.channel ?? {};
    form.downloadVideos = Number(c.download_videos) === 1;
    form.downloadShorts = Number(c.download_shorts) === 1;
    form.downloadLives = Number(c.download_lives) === 1;
    form.dateAfter = toInputDate(c.date_after);
    form.customSavePath = c.custom_save_path || '';
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => props.channelId, (id) => { if (id) load(id); }, { immediate: true });

async function save() {
  const id = props.channelId;
  if (!id) return;
  saving.value = true;
  try {
    await $fetch(`/api/admin/channels/${encodeURIComponent(id)}/options`, {
      method: 'PUT',
      body: {
        downloadVideos: form.downloadVideos,
        downloadShorts: form.downloadShorts,
        downloadLives: form.downloadLives,
        dateAfter: form.dateAfter || null,
        customSavePath: form.customSavePath.trim() || null,
      },
    });
    toast.success('Channel options saved.');
    emit('saved');
    emit('close');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the channel options.');
    // Show what the server actually kept.
    await load(id);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.channel-options-form { display: flex; flex-direction: column; gap: 12px; }
.channel-options-checks { display: flex; gap: 16px; flex-wrap: wrap; }
.channel-options-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
</style>
