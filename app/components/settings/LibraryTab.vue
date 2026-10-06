<template>
  <div class="tab-pane library-tab">
    <div class="downloads-header-panel glass-panel">
      <div class="header-text">
        <h2>Library</h2>
        <p>Choose what YouKeep follows. New videos, tracks and episodes from everything you follow are downloaded automatically.</p>
      </div>
    </div>

    <LibrarySourceSection
      v-for="kind in LIBRARY_SECTIONS"
      :key="kind"
      :config="LIBRARY_SOURCES[kind]"
      :open="openSection === null || openSection === kind"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import LibrarySourceSection from '~/components/settings/LibrarySourceSection.vue';
import { LIBRARY_SOURCES } from '~/utils/librarySources';
import { LIBRARY_SECTIONS, type LibrarySection } from '~/utils/settingsTabs';

const props = defineProps<{ section: LibrarySection | null }>();

const openSection = ref<LibrarySection | null>(props.section);

function scrollToSection(section: LibrarySection | null) {
  if (!section) return;
  nextTick(() => {
    document.getElementById(`library-${section}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
}

watch(() => props.section, (section) => {
  openSection.value = section;
  scrollToSection(section);
});

onMounted(() => scrollToSection(props.section));
</script>
