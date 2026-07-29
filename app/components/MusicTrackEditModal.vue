<template>
  <BaseModal :show="show" title="Modifier la piste" @close="$emit('close')">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="track-edit-title">Titre *</label>
        <input id="track-edit-title" v-model="form.title" type="text" required class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="track-edit-number">N° de piste</label>
        <input id="track-edit-number" v-model.number="form.trackNumber" type="number" min="1" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="track-edit-genre">Genre</label>
        <input id="track-edit-genre" v-model="form.genre" type="text" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="track-edit-language">Langue</label>
        <input id="track-edit-language" v-model="form.language" type="text" class="form-input" />
      </div>
      <div class="modal-footer" style="margin-top: 24px; padding: 0; border: none;">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">Annuler</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Enregistrement...' : 'Enregistrer' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{
  show: boolean;
  track: { id: string; title: string; track_number: number | null; genre: string | null; language: string | null } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', track: any): void;
}>();

const toast = useToast();
const saving = ref(false);
const form = ref<{ title: string; trackNumber: number | string; genre: string; language: string }>({
  title: '',
  trackNumber: '',
  genre: '',
  language: ''
});

watch(
  () => props.track,
  (t) => {
    if (t) {
      form.value = {
        title: t.title || '',
        trackNumber: t.track_number ?? '',
        genre: t.genre || '',
        language: t.language || ''
      };
    }
  },
  { immediate: true }
);

async function handleSubmit() {
  if (!props.track) return;
  saving.value = true;
  try {
    const data = await $fetch<any>(`/api/admin/music/tracks/${props.track.id}`, {
      method: 'PATCH',
      body: {
        title: form.value.title,
        trackNumber: form.value.trackNumber,
        genre: form.value.genre,
        language: form.value.language
      }
    });
    toast.success('Piste mise à jour.');
    emit('saved', data.track);
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Erreur lors de la mise à jour de la piste.');
  } finally {
    saving.value = false;
  }
}
</script>
