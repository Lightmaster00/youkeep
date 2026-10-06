<template>
  <details class="glass-panel downloads-advanced" data-testid="downloads-advanced">
    <summary class="downloads-advanced-summary">
      <span class="downloads-advanced-title">Advanced</span>
      <span class="section-desc">Automatic sync schedules, sponsor segments in videos, and music video clips.</span>
    </summary>

    <div class="downloads-advanced-body">
      <section>
        <h3>Scheduled sync</h3>
        <p class="section-desc">Check everything you follow for new content at set times.</p>
        <div class="advanced-schedules">
          <ScheduleForm title="Videos" endpoint="/api/admin/downloader/schedule" :presets="VIDEO_SCHEDULE_PRESETS" daily-label="Every day at 3:00 AM" weekly-label="Every Sunday at 3:00 AM" id-prefix="video" />
          <ScheduleForm title="Music" endpoint="/api/admin/music/schedule" :presets="MUSIC_SCHEDULE_PRESETS" daily-label="Every day at 3:30 AM" weekly-label="Every Sunday at 3:30 AM" id-prefix="music" />
          <ScheduleForm title="Podcasts" endpoint="/api/admin/podcasts/schedule" :presets="PODCAST_SCHEDULE_PRESETS" daily-label="Every day at 4:00 AM" weekly-label="Every Sunday at 4:00 AM" id-prefix="podcast" />
        </div>
      </section>

      <section>
        <h3>Sponsor segments (videos)</h3>
        <p class="section-desc">Uses the community SponsorBlock database and applies to new downloads only. Each kind of segment can be kept, marked as a chapter, or cut from the file.</p>
        <p v-if="sbLoadFailed" class="section-desc" data-testid="sponsorblock-load-error">
          Could not load the current settings. Reload to try again.
          <button type="button" class="btn btn-secondary-dark" data-testid="sponsorblock-retry" @click="loadSponsorBlock">Retry</button>
        </p>
        <p v-else-if="!sbLoaded" class="section-desc" data-testid="sponsorblock-loading">Loading…</p>
        <form class="policy-forms-grid mt-3" data-testid="sponsorblock-form" @submit.prevent="saveSponsorBlock">
          <div v-for="cat in SPONSORBLOCK_CATEGORIES" :key="cat.key" class="form-group">
            <label class="form-label" :for="`sb-${cat.key}`">{{ cat.label }}</label>
            <select :id="`sb-${cat.key}`" v-model="sponsorBlock[cat.key]" class="form-select">
              <option value="ignore">Keep</option>
              <option value="mark">Mark as chapter</option>
              <option value="remove">Cut from file</option>
            </select>
          </div>
          <div class="form-actions mt-3">
            <button type="submit" class="btn btn-secondary-dark" :disabled="savingSponsorBlock || !sbLoaded">{{ savingSponsorBlock ? 'Saving...' : 'Save sponsor settings' }}</button>
          </div>
        </form>
      </section>

      <section>
        <h3>Music video clips</h3>
        <p class="section-desc">Also download the official video for each new track, next to the audio. Tracks you already have are not changed; use the clip download action on a track to get its video.</p>
        <label class="advanced-switch">
          <input type="checkbox" :checked="clipsEnabled" :disabled="togglingClips" data-testid="music-clips-toggle" @change="onClipsChange" />
          <span>{{ clipsEnabled ? 'On' : 'Off' }}</span>
        </label>
      </section>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import ScheduleForm from '~/components/settings/ScheduleForm.vue';
import { useToast } from '~/composables/useToast';
import { VIDEO_SCHEDULE_PRESETS, MUSIC_SCHEDULE_PRESETS, PODCAST_SCHEDULE_PRESETS } from '~/utils/schedulePresets';

const toast = useToast();

const SPONSORBLOCK_CATEGORIES = [
  { key: 'sponsor', label: 'Sponsor' },
  { key: 'intro', label: 'Intro' },
  { key: 'outro', label: 'Outro' },
  { key: 'selfpromo', label: 'Self-promotion' },
  { key: 'interaction', label: 'Like/subscribe reminders' },
  { key: 'filler', label: 'Filler and tangents' },
];

const sponsorBlock = ref<Record<string, string>>({
  sponsor: 'ignore', intro: 'ignore', outro: 'ignore', selfpromo: 'ignore', interaction: 'ignore', filler: 'ignore',
});
const savingSponsorBlock = ref(false);
const sbLoaded = ref(false);
const sbLoadFailed = ref(false);

async function loadSponsorBlock() {
  try {
    const data = await $fetch<{ settings?: Record<string, string> }>('/api/admin/downloader/sponsorblock');
    if (data?.settings) sponsorBlock.value = { ...sponsorBlock.value, ...data.settings };
    sbLoaded.value = true;
    sbLoadFailed.value = false;
  } catch (err) {
    console.error('Failed to fetch SponsorBlock settings:', err);
    sbLoaded.value = false;
    sbLoadFailed.value = true;
  }
}

async function saveSponsorBlock() {
  if (savingSponsorBlock.value || !sbLoaded.value) return;
  savingSponsorBlock.value = true;
  try {
    await $fetch('/api/admin/downloader/sponsorblock', { method: 'POST', body: sponsorBlock.value });
    toast.success('Sponsor settings saved.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the sponsor settings.');
    await loadSponsorBlock();
  } finally {
    savingSponsorBlock.value = false;
  }
}

const clipsEnabled = ref(false);
const togglingClips = ref(false);

async function loadClips() {
  try {
    const data = await $fetch<{ enabled: boolean }>('/api/settings/music-clips');
    clipsEnabled.value = !!data?.enabled;
  } catch {
    // keep the default
  }
}

async function onClipsChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const desired = input.checked;
  togglingClips.value = true;
  try {
    await $fetch('/api/admin/settings/music-clips', { method: 'POST', body: { enabled: desired } });
    clipsEnabled.value = desired;
    toast.success(desired ? 'Music video clips will be downloaded.' : 'Music video clips will no longer be downloaded.');
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not change the clips setting.');
  } finally {
    // One-way binding: make the box match the saved value.
    input.checked = clipsEnabled.value;
    togglingClips.value = false;
  }
}

onMounted(() => {
  loadSponsorBlock();
  loadClips();
});
</script>

<style scoped>
.downloads-advanced { padding: 20px; }
.downloads-advanced-summary { cursor: pointer; display: flex; flex-direction: column; gap: 4px; list-style: none; position: relative; padding-right: 28px; }
.downloads-advanced-summary::-webkit-details-marker { display: none; }
.downloads-advanced-summary::after { content: ''; position: absolute; right: 6px; top: 8px; width: 8px; height: 8px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); transition: transform 0.15s; }
.downloads-advanced[open] > .downloads-advanced-summary::after { transform: rotate(-135deg); top: 12px; }
.downloads-advanced-title { font-size: 18px; font-weight: 700; }
.downloads-advanced-body { display: flex; flex-direction: column; gap: 24px; margin-top: 16px; }
.downloads-advanced-body h3 { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.advanced-schedules { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; margin-top: 12px; }
.advanced-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 8px; }
</style>
