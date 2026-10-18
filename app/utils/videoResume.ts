// Where each video was left, for "resume playback" (per browser, also for
// guests). A small capped map in localStorage: { [videoId]: { t, at } }.
export const VIDEO_RESUME_KEY = 'youkeep:video-resume';
export const VIDEO_RESUME_MAX_ENTRIES = 200;
// Below this many seconds there is nothing worth resuming.
export const VIDEO_RESUME_MIN_SECONDS = 5;
// Past this share of the video it counts as watched: start over next time.
export const VIDEO_RESUME_DONE_RATIO = 0.95;

type ResumeMap = Record<string, { t: number; at: number }>;

function read(): ResumeMap {
  try {
    const raw = window.localStorage.getItem(VIDEO_RESUME_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(map: ResumeMap) {
  try {
    window.localStorage.setItem(VIDEO_RESUME_KEY, JSON.stringify(map));
  } catch {
    // Storage full or blocked: resuming is a convenience.
  }
}

export function getResumePosition(videoId: string): number | null {
  const entry = read()[videoId];
  return entry && typeof entry.t === 'number' && Number.isFinite(entry.t) ? entry.t : null;
}

/** Remembers `seconds` for the video, or forgets it once (nearly) watched to the end. */
export function saveResumePosition(videoId: string, seconds: number, duration: number) {
  const map = read();
  if (!Number.isFinite(seconds) || seconds < VIDEO_RESUME_MIN_SECONDS
    || (duration > 0 && seconds >= duration * VIDEO_RESUME_DONE_RATIO)) {
    if (videoId in map) {
      delete map[videoId];
      write(map);
    }
    return;
  }
  map[videoId] = { t: Math.floor(seconds), at: Date.now() };
  const ids = Object.keys(map);
  if (ids.length > VIDEO_RESUME_MAX_ENTRIES) {
    ids.sort((a, b) => map[a]!.at - map[b]!.at);
    for (const id of ids.slice(0, ids.length - VIDEO_RESUME_MAX_ENTRIES)) delete map[id];
  }
  write(map);
}

export function clearResumePosition(videoId: string) {
  const map = read();
  if (videoId in map) {
    delete map[videoId];
    write(map);
  }
}

/** Where to start when resuming: null when the saved spot is too early or too late. */
export function resumeTarget(saved: number | null, duration: number): number | null {
  if (saved === null || saved < VIDEO_RESUME_MIN_SECONDS) return null;
  if (duration > 0 && saved >= duration * VIDEO_RESUME_DONE_RATIO) return null;
  return saved;
}

/** "?t=" values: 90, "90", "90s", "1m30s", "1h2m3s". Null when absent or invalid. */
export function parseStartTime(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}
