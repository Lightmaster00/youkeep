<script setup lang="ts">
definePageMeta({
  middleware: [
    function () {
      return navigateTo('/settings?tab=downloads');
    }
  ]
});
</script>

<template>
  <div class="redirecting-container">
    <p>Redirecting...</p>
  </div>
</template>

<style scoped>
.redirecting-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 50vh;
  color: var(--text-secondary);
}
</style>
