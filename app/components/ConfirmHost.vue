<template>
  <ConfirmDialog
    :show="!!pendingConfirm"
    :title="pendingConfirm?.title || ''"
    :message="pendingConfirm?.message || ''"
    :confirm-label="pendingConfirm?.confirmLabel || t('common.confirm')"
    @confirm="answerConfirm(true)"
    @cancel="answerConfirm(false)"
  />
</template>

<script setup lang="ts">
const { t } = useI18n();
// The one dialog behind confirmAction() (app/composables/useConfirm.ts).
import { pendingConfirm, answerConfirm } from '~/composables/useConfirm';
</script>
