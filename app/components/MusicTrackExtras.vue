<template>
  <span class="mte">
    <button
      v-if="track.has_clip"
      type="button"
      class="badge mte-clip"
      title="Watch the clip"
      @click="toggleClip"
    >
      Clip
    </button>
    <button
      v-else-if="isAdmin"
      type="button"
      class="mte-download"
      :disabled="downloading"
      :title="downloading ? 'Downloading the clip…' : 'Download clip'"
      :aria-label="downloading ? 'Downloading the clip' : 'Download clip'"
      @click="downloadClip"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
    </button>
    <button
      v-if="isAdmin"
      type="button"
      class="mte-edit"
      title="Edit"
      aria-label="Edit track"
      @click="emit('edit', track)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
    </button>
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useMusicPlayer } from '~/composables/useMusicPlayer';
import { usePlayTrackList } from '~/composables/usePlayTrackList';
import { useToast } from '~/composables/useToast';

// Extra per-row buttons of the artist and album pages (for MusicTrackList's
// `actions` slot): the clip toggle, and for admins "Download clip" and Edit.
// `list` is the list the row belongs to, used as the queue for the clip.
const props = defineProps<{ track: any; list: any[] }>();
const emit = defineEmits<{ edit: [track: any] }>();

const { isAdmin } = useAuth();
const { currentTrack, clipMode, setClipMode } = useMusicPlayer();
const { playFrom } = usePlayTrackList();
const toast = useToast();
const downloading = ref(false);

function toggleClip() {
  if (currentTrack.value?.id !== props.track.id) {
    playFrom(props.track, props.list);
    setClipMode(true);
  } else {
    setClipMode(!clipMode.value);
  }
}

async function downloadClip() {
  if (downloading.value) return;
  downloading.value = true;
  try {
    await $fetch(`/api/admin/music/tracks/${props.track.id}/download-clip`, { method: 'POST' });
    toast.success('Clip download started — reload the page in a few minutes to see the badge.');
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Failed to start the clip download.');
  } finally {
    downloading.value = false;
  }
}
</script>

<style scoped>
.mte {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mte-clip {
  cursor: pointer;
  border: none;
  background: rgba(139, 92, 246, 0.15);
  color: var(--accent-primary);
}

.mte-clip:hover {
  background: rgba(139, 92, 246, 0.25);
}

.mte-edit,
.mte-download {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
  align-items: center;
}

.mte-edit:hover,
.mte-download:hover:not(:disabled) {
  color: var(--text-primary);
}

.mte-download:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
