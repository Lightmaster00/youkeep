<template>
  <div>
    <!-- Channel Banner -->
    <div
      class="channel-banner-container glass-panel"
      :style="channel.banner_url ? { backgroundImage: `url(${channel.banner_url}), linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
    >
      <div class="banner-overlay"></div>
    </div>

    <!-- Channel Profile Header -->
    <div class="channel-profile-header">
      <img
        :src="channel.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'"
        @error="handleAvatarError"
        class="channel-profile-avatar"
        alt="Avatar"
      />
      <div class="channel-profile-info">
        <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <h1 class="channel-profile-title">{{ channel.title }}</h1>
          <span v-if="isAdmin" class="badge" :class="channel.sync_status === 'downloading' ? 'badge-completed' : 'badge-pending'">
            {{ channel.sync_status === 'downloading' ? 'Sync Active' : 'Sync Paused' }}
          </span>
          <span class="badge" :class="getVisBadgeClass(channel.visibility)">
            {{ formatVisibility(channel.visibility) }}
          </span>
        </div>
        <p class="channel-profile-meta">
          YouTube Channel • ID : {{ channel.id }} • {{ channelVideos.filter((v: any) => v.download_status === 'completed').length }} / {{ channelVideos.length }} videos archived
        </p>
        <p class="channel-profile-desc">{{ channel.description || 'No description available.' }}</p>

        <div class="channel-actions-row">
          <button
            @click="handleToggleSubscription"
            class="btn subscribe-btn"
            :class="subscribed ? 'btn-secondary' : 'btn-primary'"
          >
            <svg v-if="subscribed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>{{ subscribed ? 'Subscribed' : "Subscribe" }}</span>
          </button>
          <button
            v-if="isAdmin"
            @click="$emit('open-drawer')"
            class="btn btn-secondary settings-trigger-btn"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
            <span>Tracking options</span>
          </button>
          <button
            v-if="isAdmin"
            @click="handleToggleSyncStatus"
            class="btn btn-secondary"
            :disabled="togglingSyncStatus"
          >
            <span>{{ channel.sync_status === 'downloading' ? 'Pause Sync' : 'Resume Sync' }}</span>
          </button>

        </div>
      </div>
    </div>

    <!-- Non-synchronized Channel Warning Banner -->
    <div v-if="singleChannelData?.stats && singleChannelData.stats.totalCount === 0" class="sync-warning-banner glass-panel">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #60a5fa; flex-shrink: 0; margin-top: 1px;" :class="{ 'spin-anim': triggeringSync }"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      <div class="warning-text">
        <h4 style="font-size: 14px; font-weight: 700; color: white; margin: 0;">
          {{ triggeringSync ? 'Initial video search...' : 'Empty or unsynced channel' }}
        </h4>
        <p style="font-size: 13.5px; color: var(--text-secondary); margin: 4px 0 0 0; line-height: 1.45;">
          {{ triggeringSync ? 'YouKeep is querying YouTube to retrieve the list of videos for this channel. Please wait.' : 'No videos have been discovered for this channel yet. YouKeep will automatically launch a search in the background to synchronize the list.' }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';
import { useChannelDetail } from '~/composables/useChannelDetail';
import { useChannelsList } from '~/composables/useChannelsList';

defineEmits<{ 'open-drawer': [] }>();

const { isAdmin } = useAuth();
const toast = useToast();

const { channelId, channel, singleChannelData, channelVideos, refreshSingleChannel } = await useChannelDetail();
const { refreshChannels } = await useChannelsList();

const subscribed = ref(false);
const togglingSyncStatus = ref(false);
const triggeringSync = ref(false);

const fetchSubscriptionStatus = async () => {
  if (!channelId.value) return;
  try {
    const res = await $fetch<any>(`/api/channels/${channelId.value}/subscription`);
    subscribed.value = res.subscribed;
  } catch (err) {
    console.error('Failed to fetch subscription status:', err);
  }
};

const handleToggleSubscription = async () => {
  if (!channelId.value) return;
  const endpoint = subscribed.value ? 'unsubscribe' : 'subscribe';
  try {
    await $fetch(`/api/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    subscribed.value = !subscribed.value;
    toast.success(subscribed.value ? 'Subscription saved.' : 'Subscription removed.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

const handleToggleSyncStatus = async () => {
  if (!channelId.value || !channel.value) return;
  togglingSyncStatus.value = true;
  const isPaused = channel.value.sync_status !== 'downloading';
  const endpoint = isPaused ? 'sync' : 'pause';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    toast.success(isPaused ? 'Sync resumed.' : 'Sync paused.');
    await refreshSingleChannel();
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  } finally {
    togglingSyncStatus.value = false;
  }
};

async function handleTriggerManualSync() {
  if (!channelId.value) return;
  triggeringSync.value = true;
  try {
    const channelUrl = `https://www.youtube.com/channel/${channelId.value}`;
    const res = await $fetch<any>('/api/admin/downloader/ingest', {
      method: 'POST',
      body: { url: channelUrl }
    });
    toast.success(res.message || 'Channel update completed.');
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to search videos.');
  } finally {
    triggeringSync.value = false;
  }
};

watch(channel, (newVal) => {
  if (newVal) {
    fetchSubscriptionStatus();

    // Auto-check YouTube in background if the channel has never been scanned (totalCount === 0)
    if (singleChannelData.value?.stats?.totalCount === 0 && !triggeringSync.value) {
      handleTriggerManualSync();
    }
  }
}, { immediate: true });

const formatVisibility = (vis: string): string => {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
};

const getVisBadgeClass = (vis: string): string => {
  switch (vis) {
    case 'public': return 'badge-completed';
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};
</script>
