<template>
  <BaseModal :show="show" title="Modifier l'album" @close="$emit('close')">
    <form @submit.prevent="handleSubmit">
      <div class="form-group">
        <label for="album-edit-title">Titre *</label>
        <input id="album-edit-title" v-model="form.title" type="text" required class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="album-edit-year">Année</label>
        <input id="album-edit-year" v-model.number="form.releaseYear" type="number" min="1900" max="2100" class="form-input" />
      </div>
      <div class="form-group" style="margin-top: 16px;">
        <label for="album-edit-cover">URL de la pochette</label>
        <input id="album-edit-cover" v-model="form.coverUrl" type="text" placeholder="https://..." class="form-input" />
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
  album: { id: string; title: string; release_year: number | null; cover_url: string | null; manual_cover_url: string | null } | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved', album: any): void;
}>();

const toast = useToast();
const saving = ref(false);
const form = ref<{ title: string; releaseYear: number | string; coverUrl: string }>({
  title: '',
  releaseYear: '',
  coverUrl: ''
});

watch(
  () => props.album,
  (a) => {
    if (a) {
      form.value = {
        title: a.title || '',
        releaseYear: a.release_year ?? '',
        coverUrl: a.manual_cover_url || ''
      };
    }
  },
  { immediate: true }
);

async function handleSubmit() {
  if (!props.album) return;
  saving.value = true;
  try {
    const data = await $fetch<any>(`/api/admin/music/albums/${props.album.id}`, {
      method: 'PATCH',
      body: {
        title: form.value.title,
        releaseYear: form.value.releaseYear,
        coverUrl: form.value.coverUrl
      }
    });
    toast.success('Album mis à jour.');
    emit('saved', data.album);
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || "Erreur lors de la mise à jour de l'album.");
  } finally {
    saving.value = false;
  }
}
</script>
