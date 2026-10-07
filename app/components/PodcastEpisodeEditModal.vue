<template>
  <BaseModal :show="show" title="Edit episode" @close="$emit('close')">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="episode-edit-title">Title *</label>
        <input id="episode-edit-title" v-model="form.title" type="text" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="episode-edit-number">Episode number</label>
        <input id="episode-edit-number" v-model.number="form.episodeNumber" type="number" min="1" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="episode-edit-season">Season number</label>
        <input id="episode-edit-season" v-model.number="form.seasonNumber" type="number" min="1" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="episode-edit-description">Description</label>
        <textarea id="episode-edit-description" v-model="form.description" rows="5" class="form-input"></textarea>
      </div>
      <div class="modal-footer" style="margin-top: 24px; padding: 0; border: none;">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">Cancel</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{
  show: boolean;
  episode: { id: string; title: string; description: string | null; episode_number: number | null; season_number: number | null } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', episode: any): void;
}>();

const toast = useToast();
const saving = ref(false);
const form = ref<{ title: string; description: string; episodeNumber: number | string; seasonNumber: number | string }>({
  title: '',
  description: '',
  episodeNumber: '',
  seasonNumber: ''
});

watch(
  () => props.episode,
  (ep) => {
    if (ep) {
      form.value = {
        title: ep.title || '',
        description: ep.description || '',
        episodeNumber: ep.episode_number ?? '',
        seasonNumber: ep.season_number ?? ''
      };
    }
  },
  { immediate: true }
);

async function handleSubmit() {
  if (!props.episode) return;
  saving.value = true;
  try {
    const data = await $fetch<any>(`/api/admin/podcasts/episodes/${props.episode.id}`, {
      method: 'PATCH',
      body: {
        title: form.value.title,
        description: form.value.description,
        episodeNumber: form.value.episodeNumber,
        seasonNumber: form.value.seasonNumber
      }
    });
    toast.success('Episode updated.');
    emit('saved', data.episode);
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || "Failed to update the episode.");
  } finally {
    saving.value = false;
  }
}
</script>
