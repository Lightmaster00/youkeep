<template>
  <div v-if="show" class="modal-overlay" @click="$emit('close')">
    <div
      ref="modalCardEl"
      class="modal-card glass-panel animate-pop"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      @click.stop
    >
      <div class="modal-header">
        <h3 :id="titleId">{{ title }}</h3>
        <button type="button" class="close-modal-btn" :aria-label="$t('common.close')" @click="$emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <slot></slot>
      </div>
      <div v-if="$slots.footer" class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// Open modals, innermost last. Escape and the focus trap only act for the
// topmost one, so closing a modal opened from another closes just that one.
const openModals: symbol[] = [];
let titleSeq = 0;

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]:not([tabindex="-1"])',
].join(',');
</script>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  show: boolean;
  title: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const modalCardEl = ref<HTMLElement | null>(null);
const titleId = `modal-title-${++titleSeq}`;
const self = Symbol('modal');
let previouslyFocusedEl: HTMLElement | null = null;
let listening = false;

const isTopmost = () => openModals[openModals.length - 1] === self;

function focusables(): HTMLElement[] {
  const card = modalCardEl.value;
  if (!card) return [];
  return Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

function onKeydown(e: KeyboardEvent) {
  if (!isTopmost()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }
  if (e.key !== 'Tab') return;
  const card = modalCardEl.value;
  if (!card) return;
  const items = focusables();
  if (items.length === 0) {
    e.preventDefault();
    card.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && card.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first || active === card) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}

function open() {
  if (listening) return;
  listening = true;
  previouslyFocusedEl = document.activeElement as HTMLElement | null;
  openModals.push(self);
  document.addEventListener('keydown', onKeydown);
  nextTick(() => {
    modalCardEl.value?.focus();
  });
}

function close(restoreFocus: boolean) {
  if (!listening) return;
  listening = false;
  document.removeEventListener('keydown', onKeydown);
  const index = openModals.indexOf(self);
  if (index !== -1) openModals.splice(index, 1);
  if (restoreFocus && previouslyFocusedEl && document.contains(previouslyFocusedEl)) {
    previouslyFocusedEl.focus();
  }
  previouslyFocusedEl = null;
}

watch(() => props.show, (isShown) => {
  if (isShown) open();
  else close(true);
});

// A modal rendered already open (e.g. under a v-if) traps focus too.
onMounted(() => {
  if (props.show) open();
});

onUnmounted(() => close(true));
</script>
