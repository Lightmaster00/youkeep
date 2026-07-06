<template>
  <div class="empty-state">
    <div class="empty-state-visual">
      <div class="glow-orb orb-1"></div>
      <div class="glow-orb orb-2"></div>
      <div class="icon-container">
        <!-- Subscriptions / Library Book -->
        <svg v-if="icon === 'book'" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>

        <!-- Channels / YouTube Play -->
        <svg v-else-if="icon === 'channels'" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon">
          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path>
          <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon>
        </svg>

        <!-- Shorts / Film Strip -->
        <svg v-else-if="icon === 'shorts'" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
          <line x1="7" y1="2" x2="7" y2="22"></line>
          <line x1="17" y1="2" x2="17" y2="22"></line>
          <line x1="2" y1="12" x2="22" y2="12"></line>
        </svg>

        <!-- Playlists Folders -->
        <svg v-else-if="icon === 'folder'" xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          <line x1="12" y1="11" x2="12" y2="17"></line>
          <line x1="9" y1="14" x2="15" y2="14"></line>
        </svg>

        <!-- Videos / Default Play icon -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="main-icon">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
        </svg>
      </div>
    </div>
    <div class="empty-state-content">
      <h3 class="empty-title">{{ title }}</h3>
      <p class="empty-desc">{{ description }}</p>
      
      <!-- Render Link Button if actionRoute and actionText exist -->
      <NuxtLink v-if="actionRoute && actionText" :to="actionRoute" class="btn-premium-pulse">
        <slot name="button-icon"></slot>
        {{ actionText }}
      </NuxtLink>
      
      <!-- Render Regular Button if actionText exists but no actionRoute (emits click) -->
      <button v-else-if="actionText" @click="$emit('action')" class="btn-premium-pulse">
        <slot name="button-icon"></slot>
        {{ actionText }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  icon?: 'book' | 'channels' | 'shorts' | 'folder' | 'video';
  actionText?: string;
  actionRoute?: string;
}>();

defineEmits<{
  (e: 'action'): void;
}>();
</script>
