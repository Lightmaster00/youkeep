<template>
  <div class="cat-editor" data-testid="category-editor">
    <div class="cat-editor__head">
      <h4 class="cat-editor__title" id="cat-editor-title">Categories</h4>
      <span class="cat-editor__mode" data-testid="category-mode">{{ override === null ? 'Automatic' : 'Set by hand' }}</span>
    </div>
    <p class="cat-editor__hint">
      {{ override === null
        ? 'Taken from the YouTube categories of this channel\'s videos.'
        : 'These replace the automatic categories everywhere.' }}
    </p>

    <ul v-if="current.length > 0" class="cat-editor__list" aria-labelledby="cat-editor-title">
      <li v-for="name in current" :key="name" class="cat-editor__chip">
        <span class="cat-editor__chip-label">{{ name }}</span>
        <button
          type="button"
          class="cat-editor__remove"
          :aria-label="`Remove ${name}`"
          :disabled="saving"
          :data-testid="`category-remove-${name}`"
          @click="remove(name)"
        >&times;</button>
      </li>
    </ul>
    <p v-else class="cat-editor__empty">No categories.</p>

    <form class="cat-editor__add" @submit.prevent="add">
      <label class="sr-only" for="cat-editor-input">Add a category</label>
      <input
        id="cat-editor-input"
        v-model="draft"
        type="text"
        class="form-input"
        list="cat-editor-known"
        maxlength="40"
        placeholder="Add a category"
        autocomplete="off"
        :disabled="saving || current.length >= MAX"
        data-testid="category-input"
      />
      <datalist id="cat-editor-known">
        <option v-for="name in suggestions" :key="name" :value="name" />
      </datalist>
      <button type="submit" class="btn btn-secondary btn-sm" :disabled="!canAdd" data-testid="category-add">Add</button>
    </form>
    <p v-if="current.length >= MAX" class="cat-editor__hint">At most {{ MAX }} categories.</p>

    <button
      type="button"
      class="btn btn-secondary btn-sm cat-editor__reset"
      :disabled="saving || override === null"
      data-testid="category-reset"
      @click="save(null)"
    >Reset to automatic</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useToast } from '~/composables/useToast';

// The admin's category editor of a channel (Tracking options drawer): remove
// a chip, add one from the known categories or as free text, or go back to
// the automatic categories. Every change is saved at once.
const MAX = 5;

const props = defineProps<{
  channelId: string;
  categories: string[];
  override: string[] | null;
}>();
const emit = defineEmits<{ (e: 'saved', categories: string[]): void }>();

const toast = useToast();
const current = ref<string[]>([...props.categories]);
const override = ref<string[] | null>(props.override);
const draft = ref('');
const saving = ref(false);
const known = ref<string[]>([]);

watch(() => [props.categories, props.override] as const, ([categories, value]) => {
  if (saving.value) return;
  current.value = [...categories];
  override.value = value;
});

onMounted(async () => {
  try {
    const res = await $fetch<{ categories: { name: string }[] }>('/api/channels/categories');
    known.value = (res?.categories ?? []).map((c) => c.name);
  } catch {
    known.value = [];
  }
});

const has = (name: string) => current.value.some((c) => c.toLowerCase() === name.toLowerCase());
const suggestions = computed(() => known.value.filter((name) => !has(name)));
const canAdd = computed(() => !saving.value && current.value.length < MAX && draft.value.trim() !== '' && !has(draft.value.trim()));

async function save(next: string[] | null) {
  if (saving.value) return;
  saving.value = true;
  try {
    const res = await $fetch<{ categories: string[]; override: string[] | null }>(
      `/api/admin/channels/${encodeURIComponent(props.channelId)}/categories`,
      { method: 'PUT', body: { categories: next } },
    );
    current.value = res.categories;
    override.value = res.override;
    draft.value = '';
    toast.success(next === null ? 'Categories reset to automatic.' : 'Categories saved.');
    emit('saved', res.categories);
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Could not save the categories.');
  } finally {
    saving.value = false;
  }
}

function add() {
  if (!canAdd.value) return;
  void save([...current.value, draft.value.trim()]);
}

function remove(name: string) {
  void save(current.value.filter((c) => c !== name));
}
</script>

<style scoped>
.cat-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cat-editor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cat-editor__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.cat-editor__mode {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}
.cat-editor__hint,
.cat-editor__empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.cat-editor__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cat-editor__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 4px 2px 10px;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.14);
  color: #c4b5fd;
  font-size: 12.5px;
}
.cat-editor__chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-editor__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.cat-editor__remove:hover { background: rgba(255, 255, 255, 0.1); }
.cat-editor__remove:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}
.cat-editor__add {
  display: flex;
  gap: 8px;
}
.cat-editor__add .form-input {
  flex: 1;
  min-width: 0;
}
.cat-editor__reset { align-self: flex-start; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
