<template>
  <div class="subscriptions-page">
    <header class="subs-header">
      <h1 class="page-title subs-title">{{ t('subscriptions.title') }}</h1>
    </header>

    <!-- Loading the followed channels -->
    <div v-if="channelsPending" class="subs-chip-skeleton" data-testid="subs-channels-loading" aria-busy="true">
      <UiSkeleton v-for="n in 6" :key="n" width="120px" height="36px" rounded="lg" />
    </div>

    <p v-else-if="channelsError" class="subs-error" role="alert">{{ channelsError }}</p>

    <!-- Not following anyone yet: a few channels to start with. -->
    <section v-else-if="channels.length === 0" class="subs-start" data-testid="subs-empty">
      <EmptyState
        :title="t('subscriptions.emptyTitle')"
        :description="t('subscriptions.emptyDesc')"
        icon="book"
        :action-text="t('subscriptions.browseAll')"
        action-route="/channels"
      />
      <div v-if="suggestions.length > 0" class="subs-suggestions" data-testid="subs-suggestions">
        <h2 class="subs-suggestions__title">{{ t('subscriptions.startWith') }}</h2>
        <div class="subs-suggestions__grid">
          <HomeChannelCard
            v-for="channel in suggestions"
            :key="channel.id"
            :channel="channel"
            :can-subscribe="loggedIn"
            @subscription="onSuggestionSubscribed"
          />
        </div>
      </div>
    </section>

    <template v-else>
      <SubscriptionsChipBar :channels="channels" :model-value="activeChannelId" @update:model-value="selectChannel" />

      <div class="subs-tabs" role="tablist" :aria-label="t('subscriptions.view')" @keydown="onTabKeydown">
        <button
          v-for="tb in TABS"
          :id="`subs-tab-${tb.id}`"
          :key="tb.id"
          type="button"
          role="tab"
          class="subs-tab"
          :class="{ 'is-active': tab === tb.id }"
          :aria-selected="tab === tb.id ? 'true' : 'false'"
          :aria-controls="`subs-panel-${tb.id}`"
          :tabindex="tab === tb.id ? 0 : -1"
          :data-testid="`subs-tab-${tb.id}`"
          @click="selectTab(tb.id)"
        >
          {{ t(tb.labelKey) }}
          <span v-if="tb.id === 'channels'" class="subs-tab__count">{{ channels.length }}</span>
        </button>
      </div>

      <div
        v-if="tab === 'latest'"
        id="subs-panel-latest"
        role="tabpanel"
        aria-labelledby="subs-tab-latest"
        data-testid="subs-panel-latest"
      >
        <SubscriptionsLatest
          :channel-id="activeChannelId"
          :categories="categories"
          :logged-in="loggedIn"
          :reload-key="reloadKey"
          :any-new="anyNew"
          @all-seen="onAllSeen"
        />
      </div>

      <div
        v-else
        id="subs-panel-channels"
        role="tabpanel"
        aria-labelledby="subs-tab-channels"
        data-testid="subs-panel-channels"
      >
        <div class="subs-channel-grid">
          <SubscriptionsChannelCard
            v-for="channel in channels"
            :key="channel.id"
            :channel="channel"
            :busy="unsubscribing === channel.id"
            @unsubscribe="unsubscribe"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import HomeChannelCard from '~/components/home/HomeChannelCard.vue';
import SubscriptionsChipBar from '~/components/subscriptions/SubscriptionsChipBar.vue';
import SubscriptionsLatest from '~/components/subscriptions/SubscriptionsLatest.vue';
import SubscriptionsChannelCard from '~/components/subscriptions/SubscriptionsChannelCard.vue';
import { confirmAction } from '~/composables/useConfirm';
import { useToast } from '~/composables/useToast';
import type { SubscribedChannel } from '~/utils/subscriptionTypes';

const { t } = useI18n();
useHead({ title: computed(() => t('subscriptions.title')) });

type Tab = 'latest' | 'channels';
const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'latest', labelKey: 'subscriptions.tabLatest' },
  { id: 'channels', labelKey: 'subscriptions.tabChannels' },
];
const SUGGESTION_COUNT = 6;

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuth();
const loggedIn = computed(() => auth.isLoggedIn.value);

const channels = ref<SubscribedChannel[]>([]);
const channelsPending = ref(true);
const channelsError = ref('');
const suggestions = ref<any[]>([]);
const unsubscribing = ref<string | null>(null);
const reloadKey = ref(0);

// The tab and the channel filter live in the address (?tab=channels, ?channel=<id>).
const tab = computed<Tab>(() => (route.query.tab === 'channels' ? 'channels' : 'latest'));
const queryChannel = computed(() => (typeof route.query.channel === 'string' ? route.query.channel : ''));
// A channel the viewer no longer follows filters nothing.
const activeChannelId = computed(() => (channels.value.some((c) => c.id === queryChannel.value) ? queryChannel.value : ''));

const categories = computed(() => [...new Set(channels.value.flatMap((c) => c.categories ?? []))].sort((a, b) => a.localeCompare(b, 'en-US')));
const anyNew = computed(() => channels.value.some((c) => c.newCount > 0));

function replaceQuery(patch: Record<string, string | undefined>) {
  const query: Record<string, any> = { ...route.query, ...patch };
  for (const key of Object.keys(query)) if (query[key] === undefined || query[key] === '') delete query[key];
  return router.replace({ query });
}

function selectTab(id: Tab) {
  if (id !== tab.value) replaceQuery({ tab: id === 'latest' ? undefined : id });
}

// Picking a channel shows its latest videos.
function selectChannel(id: string) {
  replaceQuery({ channel: id || undefined, tab: undefined });
}

function onTabKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const i = TABS.findIndex((tb) => tb.id === tab.value);
  const next = TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
  selectTab(next.id);
  // Keep the keyboard on the newly selected tab.
  requestAnimationFrame(() => document.getElementById(`subs-tab-${next.id}`)?.focus());
}

async function loadChannels() {
  if (!loggedIn.value) {
    channelsPending.value = false;
    return;
  }
  channelsError.value = '';
  try {
    const res = await $fetch<{ channels: SubscribedChannel[] }>('/api/subscriptions/channels');
    channels.value = res?.channels ?? [];
  } catch (err: any) {
    channelsError.value = err?.data?.statusMessage || t('subscriptions.loadFailed');
  } finally {
    channelsPending.value = false;
  }
  if (channels.value.length === 0 && !channelsError.value) await loadSuggestions();
}

// Library channels with videos (none is followed yet), as starting points.
async function loadSuggestions() {
  try {
    const res = await $fetch<{ channels: any[] }>('/api/channels');
    suggestions.value = (res?.channels ?? [])
      .filter((c) => (c.completed_count ?? 0) > 0)
      .sort((a, b) => (b.completed_count ?? 0) - (a.completed_count ?? 0))
      .slice(0, SUGGESTION_COUNT)
      .map((c) => ({ id: c.id, title: c.title, avatar_url: c.avatar_url, video_count: c.completed_count, categories: c.categories ?? [] }));
  } catch {
    suggestions.value = [];
  }
}

async function onSuggestionSubscribed(_id: string, subscribed: boolean) {
  if (!subscribed) return;
  await loadChannels();
}

function onAllSeen() {
  channels.value = channels.value.map((c) => ({ ...c, newCount: 0 }));
}

async function unsubscribe(channel: SubscribedChannel) {
  const ok = await confirmAction({
    title: t('subscriptions.unsubscribeTitle'),
    message: t('subscriptions.unsubscribeMessage', { title: channel.title }),
    confirmLabel: t('common.unsubscribe'),
  });
  if (!ok) return;
  unsubscribing.value = channel.id;
  try {
    await $fetch(`/api/channels/${encodeURIComponent(channel.id)}/unsubscribe`, { method: 'POST' });
    channels.value = channels.value.filter((c) => c.id !== channel.id);
    if (queryChannel.value === channel.id) await replaceQuery({ channel: undefined });
    reloadKey.value++;
    toast.success(t('subscriptions.unsubscribed', { title: channel.title }));
    if (channels.value.length === 0) await loadSuggestions();
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || t('subscriptions.unsubscribeFailed'));
  } finally {
    unsubscribing.value = null;
  }
}

onMounted(loadChannels);
</script>

<style scoped>
.subscriptions-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

/* The page is a column as tall as the viewport (main.css): its parts keep
   their own height instead of shrinking into it (the scrolling chip bar,
   overflow: auto, would otherwise be squashed to a sliver). */
.subscriptions-page > * {
  flex-shrink: 0;
}

.subs-title { margin-bottom: 0; }

.subs-chip-skeleton {
  display: flex;
  gap: 8px;
  overflow: hidden;
  padding: 4px 0 8px;
}

.subs-error {
  color: var(--text-secondary);
}

.subs-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 18px;
}

.subs-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.subs-tab:hover { color: var(--text-primary); }
.subs-tab.is-active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-primary);
}
.subs-tab:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: -2px;
  border-radius: 6px 6px 0 0;
}

.subs-tab__count {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 11.5px;
}

.subs-channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: 14px;
}

.subs-suggestions { margin-top: 8px; }
.subs-suggestions__title {
  font-size: 17px;
  font-weight: 700;
  margin: 0 0 14px;
}
.subs-suggestions__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  gap: 14px;
}

@media (max-width: 480px) {
  .subs-suggestions__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
}
</style>
