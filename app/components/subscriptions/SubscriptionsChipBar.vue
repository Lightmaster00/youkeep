<template>
  <div
    ref="bar"
    class="chip-bar"
    role="tablist"
    aria-label="Filter by channel"
    aria-orientation="horizontal"
    data-testid="subs-chip-bar"
    @keydown="onKeydown"
  >
    <button
      type="button"
      role="tab"
      class="chip"
      :class="{ 'is-active': !modelValue }"
      :aria-selected="!modelValue ? 'true' : 'false'"
      :tabindex="!modelValue ? 0 : -1"
      data-testid="chip-all"
      @click="select('')"
    >All</button>
    <button
      v-for="channel in channels"
      :key="channel.id"
      type="button"
      role="tab"
      class="chip chip--channel"
      :class="{ 'is-active': modelValue === channel.id }"
      :aria-selected="modelValue === channel.id ? 'true' : 'false'"
      :tabindex="modelValue === channel.id ? 0 : -1"
      :data-testid="`chip-${channel.id}`"
      :title="channel.title"
      @click="select(channel.id)"
    >
      <span class="chip__avatar-wrap">
        <img
          :src="channel.avatar_url || FALLBACK_AVATAR"
          class="chip__avatar"
          alt=""
          width="24"
          height="24"
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="onAvatarError"
        />
        <span v-if="channel.newCount > 0" class="chip__dot" data-testid="chip-new-dot"></span>
      </span>
      <span class="chip__label">{{ channel.title }}</span>
      <span v-if="channel.newCount > 0" class="sr-only">, {{ channel.newCount }} new</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { FALLBACK_AVATAR, setImageFallback } from '~/utils/imageFallback';

// The channel filter of the Subscriptions page: "All", then each followed
// channel with a dot while it has new videos. A tab list: one tab stop, the
// arrow keys (and Home/End) move between chips, Enter/Space or a click picks.
defineProps<{
  channels: { id: string; title: string; avatar_url?: string | null; newCount: number }[];
  modelValue: string;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', id: string): void }>();

const bar = ref<HTMLElement | null>(null);

function select(id: string) {
  emit('update:modelValue', id);
}

function onAvatarError(event: Event) {
  setImageFallback(event, FALLBACK_AVATAR);
}

function onKeydown(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key) || !bar.value) return;
  const chips = [...bar.value.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = chips.indexOf(document.activeElement as HTMLButtonElement);
  let next = current;
  if (event.key === 'ArrowLeft') next = current <= 0 ? chips.length - 1 : current - 1;
  else if (event.key === 'ArrowRight') next = current >= chips.length - 1 ? 0 : current + 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = chips.length - 1;
  event.preventDefault();
  chips[next]?.focus();
  chips[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
</script>

<style scoped>
.chip-bar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  margin: 0 -2px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.chip-bar::-webkit-scrollbar { display: none; }

.chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  max-width: 220px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast);
}
.chip--channel { padding-left: 6px; }
.chip:hover { background: var(--bg-surface-hover); }
.chip:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
.chip.is-active {
  background: var(--text-primary);
  border-color: var(--text-primary);
  color: #0c0a12;
}

.chip__avatar-wrap {
  position: relative;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
}
.chip__avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.08);
}
.chip__dot {
  position: absolute;
  right: -2px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent-primary);
  border: 2px solid var(--bg-base);
}

.chip__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
