<template>
  <BaseModal :show="show" :title="t('report.title')" @close="close">
    <form :id="formId" class="report-form" @submit.prevent="submit">
      <label class="report-label" :for="reasonId">{{ t('report.label') }}</label>
      <textarea
        :id="reasonId"
        ref="reasonEl"
        v-model="reason"
        class="form-input report-reason"
        data-testid="report-reason"
        rows="4"
        maxlength="500"
        required
        :aria-describedby="countId"
      ></textarea>
      <p :id="countId" class="report-count">{{ reason.length }} / 500</p>
      <p v-if="errorMessage" class="report-error" role="alert">{{ errorMessage }}</p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="close">{{ t('common.cancel') }}</button>
      <button type="submit" class="btn btn-danger" :form="formId" data-testid="report-submit" :disabled="!reason.trim() || sending">
        {{ sending ? t('report.sending') : t('common.report') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
// Report a video to the admins (POST /api/videos/:id/report). Signed-in
// users only; the server keeps one report per user and video.
import { ref, watch, nextTick } from 'vue';
import { useToast } from '~/composables/useToast';

const props = defineProps<{ show: boolean; videoId: string }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToast();
const { t } = useI18n();

const uid = `report-${Math.random().toString(36).slice(2, 8)}`;
const formId = `${uid}-form`;
const reasonId = `${uid}-reason`;
const countId = `${uid}-count`;
const reason = ref('');
const sending = ref(false);
const errorMessage = ref('');
const reasonEl = ref<HTMLTextAreaElement | null>(null);

watch(() => props.show, async (shown) => {
  if (!shown) return;
  reason.value = '';
  errorMessage.value = '';
  await nextTick();
  setTimeout(() => reasonEl.value?.focus(), 0);
});

function close() {
  if (!sending.value) emit('close');
}

async function submit() {
  const text = reason.value.trim();
  if (!text || sending.value) return;
  sending.value = true;
  errorMessage.value = '';
  try {
    await $fetch(`/api/videos/${encodeURIComponent(props.videoId)}/report`, { method: 'POST', body: { reason: text } });
    toast.success(t('report.thanks'));
    sending.value = false;
    emit('close');
  } catch (err: any) {
    errorMessage.value = err?.data?.statusMessage || t('report.failed');
    sending.value = false;
  }
}
</script>

<style scoped>
.report-form { display: flex; flex-direction: column; gap: 6px; }
.report-label { font-size: 13px; color: var(--text-secondary); }
.report-reason { resize: vertical; min-height: 96px; width: 100%; }
.report-count { margin: 0; font-size: 11px; color: var(--text-muted); text-align: right; }
.report-error { margin: 0; color: #f87171; font-size: 13px; }
</style>
