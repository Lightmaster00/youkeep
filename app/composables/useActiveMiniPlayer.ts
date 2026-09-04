export type ActiveMiniPlayerType = 'music' | 'podcast';

const STORAGE_KEY = 'active_mini_player_type';

// Re-declared rather than imported: these are module-private constants in
// useMusicPlayer.ts / usePodcastPlayer.ts and exporting them would widen those
// composables' public surface for no benefit. Keeping the dependency
// one-directional (players -> this file, never back) also rules out an import
// cycle, since both players call setActive() from their play().
const MUSIC_STORAGE_KEY = 'music_player_state';
const PODCAST_STORAGE_KEY = 'podcast_player_state';

// Pure. Reads the `lastPlayedAt` stamp out of a raw player payload. Returns
// null for an absent key, malformed JSON, or a legacy payload saved before
// this field existed — all three mean "this side has no claim".
export function readLastPlayedAt(rawJson: string | null): number | null {
  if (!rawJson) return null;
  let saved: any;
  try {
    saved = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!saved || typeof saved.lastPlayedAt !== 'number' || !Number.isFinite(saved.lastPlayedAt)) {
    return null;
  }
  return saved.lastPlayedAt;
}

// Pure. Whichever type played most recently wins. An exact tie is
// vanishingly unlikely with epoch-ms stamps but must still be deterministic,
// so it resolves to 'music'.
export function pickActiveFromLastPlayedAt(
  musicLastPlayedAt: number | null,
  podcastLastPlayedAt: number | null
): ActiveMiniPlayerType | null {
  if (musicLastPlayedAt === null && podcastLastPlayedAt === null) return null;
  if (podcastLastPlayedAt === null) return 'music';
  if (musicLastPlayedAt === null) return 'podcast';
  return podcastLastPlayedAt > musicLastPlayedAt ? 'podcast' : 'music';
}

export function useActiveMiniPlayer() {
  const activeType = useState<ActiveMiniPlayerType | null>('active_mini_player_type', () => null);

  function setActive(type: ActiveMiniPlayerType) {
    activeType.value = type;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, type);
    }
  }

  // Called once from app/layouts/default.vue's onMounted. Four rungs, in
  // order: (a) the persisted active type; (b) the lastPlayedAt tie-break, for
  // a session where the active key was never written; (c) whichever player
  // has a persisted session at all, which is the only rung that covers
  // sessions saved before lastPlayedAt existed; (d) null.
  function restoreActiveType() {
    if (typeof window === 'undefined') return;

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'music' || stored === 'podcast') {
      activeType.value = stored;
      return;
    }
    if (stored !== null) window.localStorage.removeItem(STORAGE_KEY);

    const musicRaw = window.localStorage.getItem(MUSIC_STORAGE_KEY);
    const podcastRaw = window.localStorage.getItem(PODCAST_STORAGE_KEY);

    const byStamp = pickActiveFromLastPlayedAt(readLastPlayedAt(musicRaw), readLastPlayedAt(podcastRaw));
    if (byStamp) {
      activeType.value = byStamp;
      return;
    }

    if (musicRaw) {
      activeType.value = 'music';
      return;
    }
    if (podcastRaw) {
      activeType.value = 'podcast';
      return;
    }
    activeType.value = null;
  }

  return { activeType, setActive, restoreActiveType };
}
