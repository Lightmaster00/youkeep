// One integer seed per browser session for /api/videos: the server uses it for
// the pseudo-random part of the feed order, so the pages of one session agree
// (paging never repeats nor skips a video).
//
// The seed lives in useState so the server-rendered first page and the client
// use the same value (sessionStorage cannot be read during SSR); the client
// keeps it in sessionStorage for pages that start without a server render.
const STORAGE_KEY = 'youkeep:feed-seed';
const SEED_RANGE = 4294967296; // 2^32, the server's accepted range is 0..2^32-1

let clientSeed: number | null = null;

function readStored(): number | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw && /^\d{1,10}$/.test(raw)) {
      const n = Number(raw);
      if (n < SEED_RANGE) return n;
    }
  } catch {
    // Storage blocked (private mode, sandbox): fall back to a fresh seed.
  }
  return null;
}

function store(seed: number) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(seed));
  } catch {
    // Not persisted: the in-memory value still keeps this page consistent.
  }
}

export function randomFeedSeed(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]!;
}

/** The session seed, for code that runs outside a component setup (client only). */
export function getFeedSeed(): number {
  if (clientSeed === null) {
    clientSeed = readStored() ?? randomFeedSeed();
    store(clientSeed);
  }
  return clientSeed;
}

/** The session seed; call from a setup function or Nuxt context. */
export function useFeedSeed(): number {
  const seed = useState<number>('feed_seed', () => (import.meta.client ? getFeedSeed() : randomFeedSeed()));
  if (import.meta.client && clientSeed !== seed.value) {
    // Hydrated from the server render: adopt it so later calls agree with page 1.
    clientSeed = seed.value;
    store(seed.value);
  }
  return seed.value;
}

/** Test helper: forget the in-memory seed. */
export function resetFeedSeedForTests() {
  clientSeed = null;
}
