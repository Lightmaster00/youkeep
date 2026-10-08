<template>
  <BaseModal :show="show" :title="title" @close="cancel">
    <p class="confirm-dialog-message">{{ message }}</p>
    <template #footer>
      <button type="button" class="btn btn-secondary" @click="cancel">Cancel</button>
      <button type="button" class="btn btn-danger confirm-dialog-confirm" :disabled="busy" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
// A yes/no question before a destructive action ("Clear history?"). The
// parent runs the action on `confirm` and closes the dialog itself; `busy`
// disables the confirm button while it runs, and cancelling is ignored then.
const props = defineProps<{ show: boolean; title: string; message: string; confirmLabel: string; busy?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

function cancel() {
  if (!props.busy) emit('cancel');
}
</script>

<style scoped>
.confirm-dialog-message {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
