<template>
  <div class="channel-directory-view">
    <div v-if="channels && channels.length > 0" class="directory-header-row">
      <h1 class="page-title">Archived Channels</h1>
    </div>

    <div v-if="pending" class="channel-grid">
      <UiCard v-for="n in 6" :key="n" flat>
        <UiSkeleton height="120px" rounded="lg" />
        <div style="padding: var(--space-3, 12px);">
          <UiSkeleton height="14px" width="70%" />
          <div style="margin-top: var(--space-2, 8px);">
            <UiSkeleton height="12px" width="40%" />
          </div>
        </div>
      </UiCard>
    </div>

    <EmptyState
      v-else-if="!channels || channels.length === 0"
      title="No channels archived"
      description="Start adding YouTube channels in the downloader settings to see them here."
      icon="channels"
      :action-text="isAdmin ? 'Add a channel' : undefined"
      action-route="/settings?tab=downloads"
    />

    <div v-else class="channel-grid">
      <div
        v-for="ch in channels"
        :key="ch.id"
        class="channel-card glass-panel"
        @click="selectChannel(ch.id)"
      >
        <!-- Banner Section -->
        <div
          class="channel-card-banner"
          :style="ch.banner_url ? { backgroundImage: `url(${ch.banner_url}), linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)` } : {}"
        >
          <div class="channel-card-banner-overlay"></div>
          <span v-if="isAdmin" class="channel-card-sync-badge" :class="ch.sync_status">
            {{ ch.sync_status === 'downloading' ? 'Active' : 'Pause' }}
          </span>
        </div>

        <!-- Content Section -->
        <div class="channel-card-body">
          <div class="channel-card-avatar-wrapper">
            <img
              :src="ch.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'"
              @error="handleAvatarError"
              class="channel-card-avatar"
              alt="Avatar"
            />
          </div>
          <div class="channel-card-info">
            <h3 class="channel-card-title" :title="ch.title">{{ ch.title }}</h3>
            <p class="channel-card-desc">{{ ch.description || 'No description available.' }}</p>

            <!-- Quick Stats row at the bottom of the card -->
            <div class="channel-card-stats">
              <span class="stat-badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
                {{ ch.completed_count || 0 }} / {{ ch.total_count || 0 }} videos
              </span>
              <span class="visibility-pill" :class="ch.visibility">
                {{ ch.visibility === 'public' ? 'Public' : 'Private' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth';
import { useChannelsList } from '~/composables/useChannelsList';

const { isAdmin } = useAuth();
const router = useRouter();

const { channels, pending } = await useChannelsList();

const selectChannel = (id: string) => {
  router.push({ path: '/channels', query: { channelId: id } });
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};
</script>
