<template>
  <form class="policy-form-block schedule-form" :data-testid="`schedule-${idPrefix}`" @submit.prevent="save">
    <h4 class="results-header">{{ title }}</h4>
    <label class="checkbox-container">
      <input v-model="form.enabled" type="checkbox" :data-testid="`schedule-${idPrefix}-enabled`" />
      <span class="checkmark"></span>
      Sync automatically on a schedule
    </label>

    <div v-if="form.enabled" class="schedule-settings-row mt-2">
      <div class="form-group flex-1">
        <label class="form-label" :for="`${idPrefix}-preset`">How often</label>
        <select :id="`${idPrefix}-preset`" v-model="form.preset" class="form-select" @change="applyPreset">
          <option value="hourly">Every hour</option>
          <option value="twelve_hours">Every 12 hours</option>
          <option value="daily">{{ dailyLabel }}</option>
          <option value="weekly">{{ weeklyLabel }}</option>
          <option value="custom">Custom (cron expression)</option>
        </select>
      </div>
      <div v-if="form.preset === 'custom'" class="form-group flex-1">
        <label class="form-label" :for="`${idPrefix}-cron`">Cron expression</label>
        <input :id="`${idPrefix}-cron`" v-model="form.schedule" type="text" class="form-input" placeholder="*/30 * * * *" />
      </div>
    </div>

    <div class="form-actions mt-3">
      <button type="submit" class="btn btn-secondary-dark" :disabled="saving">{{ saving ? 'Saving...' : 'Save schedule' }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';
import { presetForSchedule, type ScheduleKey, type SchedulePresets } from '~/utils/schedulePresets';

const props = defineProps<{
  title: string;
  endpoint: string;
  presets: SchedulePresets;
  dailyLabel: string;
  weeklyLabel: string;
  idPrefix: string;
}>();

const toast = useToast();
const saving = ref(false);
const form = reactive<{ enabled: boolean; preset: ScheduleKey | 'custom'; schedule: string }>({
  enabled: false,
  preset: 'daily',
  schedule: props.presets.daily,
});

function applyPreset() {
  if (form.preset !== 'custom') form.schedule = props.presets[form.preset];
}

async function load() {
  try {
    const data = await $fetch<{ enabled?: boolean; schedule?: string }>(props.endpoint);
    form.enabled = !!data?.enabled;
    form.schedule = data?.schedule || props.presets.daily;
    form.preset = presetForSchedule(props.presets, form.schedule);
  } catch (err) {
    console.error(`Failed to load ${props.endpoint}:`, err);
  }
}

async function save() {
  // Validated here: the browser's `required` would silently block the submit.
  if (form.enabled && form.preset === 'custom' && !form.schedule.trim()) {
    toast.error('Enter a cron expression.');
    return;
  }
  saving.value = true;
  try {
    await $fetch(props.endpoint, { method: 'POST', body: { enabled: form.enabled, schedule: form.schedule.trim() } });
    toast.success(`${props.title}: schedule saved.`);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the schedule.');
    await load();
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
