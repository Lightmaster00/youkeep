import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { uiLiteralHits } from '../helpers/uiLiterals';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LOCALES = join(ROOT, 'i18n/locales');

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

const catalogues: Record<string, Record<string, string>> = {};
for (const f of readdirSync(LOCALES).filter(n => n.endsWith('.json'))) {
  catalogues[f.replace(/\.json$/, '')] = flatten(JSON.parse(readFileSync(join(LOCALES, f), 'utf8')));
}
const en = catalogues.en!;
const others = Object.entries(catalogues).filter(([code]) => code !== 'en');

const placeholders = (msg: string) => [...new Set([...msg.matchAll(/\{(\w+)\}/g)].map(m => m[1]!))].sort();

describe('i18n catalogues', () => {
  it('has an English catalogue and at least one other', () => {
    expect(Object.keys(en).length).toBeGreaterThan(50);
    expect(others.length).toBeGreaterThan(0);
  });

  it.each(others)('%s has exactly the key set of en', (code, cat) => {
    const missing = Object.keys(en).filter(k => !(k in cat));
    const extra = Object.keys(cat).filter(k => !(k in en));
    expect({ missing, extra }, `${code}: missing ${missing.join(', ')}; extra ${extra.join(', ')}`).toEqual({ missing: [], extra: [] });
  });

  it.each(others)('%s keeps the same {placeholders} as en', (code, cat) => {
    const bad = Object.keys(en)
      .filter(k => k in cat && placeholders(en[k]!).join() !== placeholders(cat[k]!).join())
      .map(k => `${k}: en {${placeholders(en[k]!)}} vs ${code} {${placeholders(cat[k]!)}}`);
    expect(bad).toEqual([]);
  });
});

// Hard-coded text guard: every non-admin file under app/ must take its visible words from the
// catalogue. The scan covers ALL of app/ except the admin files below (they stay English on
// purpose, see englishOnly.test.ts), so a new file is checked without anyone remembering to list it.
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(vue|ts)$/.test(name) ? [full] : [];
  });
}

const ADMIN_PREFIXES = [
  // englishOnly.test.ts: 'settings components and pages'
  'app/components/settings/',
  'app/pages/settings.vue',
  'app/pages/admin/',
  'app/components/DisplayPrefsForm.vue',
];
const ADMIN_FILES = new Set([
  // englishOnly.test.ts: 'admin copy in shared utils/composables'
  'app/utils/librarySources.ts',
  'app/utils/allDownloads.ts',
  'app/utils/schedulePresets.ts',
  'app/utils/settingsTabs.ts',
  'app/composables/useAllDownloads.ts',
  'app/composables/useActiveCounts.ts',
  // Used only by admin screens (Settings > Library auto-sync, the downloads queue, the admin channel list).
  'app/utils/syncStatus.ts',
  'app/composables/useDownloadsQueue.ts',
  'app/composables/useAdminChannels.ts',
  // Admin-only editors and panels: they save through /api/admin routes.
  'app/components/channels/ChannelCategoryEditor.vue',
  'app/components/channels/ChannelSettingsDrawer.vue',
  'app/components/channels/ChannelStatsPanel.vue',
  'app/components/MusicTrackEditModal.vue',
  'app/components/MusicAlbumEditModal.vue',
  'app/components/PodcastEpisodeEditModal.vue',
]);
const isAdminFile = (rel: string) => ADMIN_FILES.has(rel) || ADMIN_PREFIXES.some(p => rel.startsWith(p));

const SCANNED = filesUnder(join(ROOT, 'app')).map(f => relative(ROOT, f)).filter(f => !isAdminFile(f)).sort();

export function templateOf(source: string): string {
  const m = source.match(/<template>[\s\S]*<\/template>/);
  // Everything from the first top-level <template> to the last </template>, then strip noise.
  return (m ? m[0] : '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, '{{}}');
}

// Literal example values that are not prose and need no translation. Keep short, one reason each.
const LITERAL_ALLOWLIST: Array<{ file: string; attr: string; reason: string }> = [
  { file: 'app/pages/login.vue', attr: 'placeholder="admin"', reason: 'example username, not a sentence' },
  { file: 'app/pages/account.vue', attr: 'placeholder="name@example.com"', reason: 'example e-mail address format' },
  { file: 'app/components/AppLogo.vue', attr: 'text "You"', reason: 'brand name YouKeep, split for styling' },
  { file: 'app/components/AppLogo.vue', attr: 'text "Keep"', reason: 'brand name YouKeep, split for styling' },
  // Admin-only controls inside shared pages: the admin side stays English (englishOnly.test.ts).
  { file: 'app/components/channels/ChannelDetailHeader.vue', attr: 'text "Tracking options"', reason: 'admin-only button' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', attr: 'title="Copy share link"', reason: 'admin-only thumbnail action' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', attr: 'title="Edit visibility"', reason: 'admin-only thumbnail action' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', attr: 'title="Delete video"', reason: 'admin-only thumbnail action' },
  // Admin-only controls inside shared music pages.
  { file: 'app/pages/music/album/[id].vue', attr: 'text "Edit album"', reason: 'admin-only button (opens the admin album editor)' },
  { file: 'app/components/MusicTrackExtras.vue', attr: 'title="Edit"', reason: 'admin-only row button (opens the admin track editor)' },
  { file: 'app/components/MusicTrackExtras.vue', attr: 'aria-label="Edit track"', reason: 'admin-only row button (opens the admin track editor)' },
  // Admin-only controls inside shared podcast components.
  { file: 'app/components/PodcastEpisodeRow.vue', attr: 'title="Edit"', reason: 'admin-only row button (opens the admin episode editor)' },
  { file: 'app/components/PodcastEpisodeRow.vue', attr: 'aria-label="Edit episode"', reason: 'admin-only row button (opens the admin episode editor)' },
];

export function hardCodedText(source: string): string[] {
  const tpl = templateOf(source);
  const hits: string[] = [];
  for (const m of tpl.matchAll(/>\s*([A-Za-z][A-Za-z' .,!?:…-]{2,}?)\s*</g)) hits.push(`text "${m[1]}"`);
  // Literal (non-bound) attributes: ` placeholder="..."`, not `:placeholder` / `v-bind:`.
  for (const m of tpl.matchAll(/(?<![:\w@#.-])(placeholder|aria-label|title|alt|description|kicker|subtitle|message|confirm-label|action-text)="([^"]*[A-Za-z][^"]*)"/g)) hits.push(`${m[1]}="${m[2]}"`);
  return hits;
}

describe('no hard-coded text in migrated files', () => {
  it('the guard itself detects literals (self-test)', () => {
    expect(hardCodedText('<template><h1>Hello</h1></template>')).toHaveLength(1);
    expect(hardCodedText('<template><p>Loading Shorts...</p></template>')).toHaveLength(1);
    expect(hardCodedText('<template><input placeholder="Name"></template>')).toHaveLength(1);
    expect(hardCodedText('<template><button aria-label="Close">{{ t(\'x\') }}</button></template>')).toHaveLength(1);
    expect(hardCodedText('<template><input :placeholder="t(\'x\')"><b>{{ t(\'y\') }}</b></template>')).toHaveLength(0);
  });

  it('scans the whole non-admin app (and not the admin files)', () => {
    expect(SCANNED.length).toBeGreaterThan(120);
    expect(SCANNED).toContain('app/pages/login.vue');
    expect(SCANNED).toContain('app/composables/useAuth.ts');
    expect(SCANNED).not.toContain('app/pages/settings.vue');
    expect(SCANNED).not.toContain('app/components/settings/DownloadsTab.vue');
  });

  it.each(SCANNED.filter(f => f.endsWith('.vue')))('%s has no hard-coded template text', (file) => {
    const allowed = LITERAL_ALLOWLIST.filter(a => a.file === file).map(a => a.attr);
    const hits = hardCodedText(readFileSync(join(ROOT, file), 'utf8')).filter(h => !allowed.includes(h));
    expect(hits, `hard-coded text in ${file}: ${hits.join('; ')}`).toEqual([]);
  });
});

// String literals bound in templates or written in scripts that read as English UI text.
// Each entry names the exact literal; add one only with a reason (non-UI string, admin-only
// control in a shared file, English default that callers override through the catalogue).
const BOUND_LITERAL_ALLOWLIST: Array<{ file: string; text: string; reason: string }> = [
  { file: 'app/app.vue', text: 'YouKeep', reason: 'brand name, never translated' },
  { file: 'app/components/VideoPlayer.vue', text: "YouKeep", reason: 'brand name used as the media-session artist, never translated' },
  { file: 'app/components/MusicTrackExtras.vue', text: "Downloading the clip\u2026", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/MusicTrackExtras.vue', text: "Download clip", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/MusicTrackExtras.vue', text: "Downloading the clip", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/MusicTrackExtras.vue', text: "Clip download started \u2014 reload the page in a few minutes to see the badge.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/MusicTrackExtras.vue', text: "Failed to start the clip download.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/PodcastShowCard.vue', text: "Public", reason: 'visibility badge shown to admins only (showVisibility / isAdmin)' },
  { file: 'app/components/PodcastShowCard.vue', text: "Private", reason: 'visibility badge shown to admins only (showVisibility / isAdmin)' },
  { file: 'app/components/PodcastShowCard.vue', text: "Ultra Private", reason: 'visibility badge shown to admins only (showVisibility / isAdmin)' },
  { file: 'app/pages/podcasts/index.vue', text: "Public", reason: 'visibility badge shown to admins only (showVisibility / isAdmin)' },
  { file: 'app/pages/podcasts/index.vue', text: "Private", reason: 'visibility badge shown to admins only (showVisibility / isAdmin)' },
  { file: 'app/pages/podcasts/index.vue', text: "Ultra Private", reason: 'visibility badge shown to admins only (showVisibility / isAdmin)' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Sync Active", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Sync Paused", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Pause Sync", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Resume Sync", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Initial video search...", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Empty or unsynced channel", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "YouKeep is querying YouTube to retrieve the list of videos for this channel. Please wait.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "No videos have been discovered for this channel yet. YouKeep will automatically launch a search in the background to synchronize the list.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Sync resumed.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Sync paused.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Action failed.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Channel update completed.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDetailHeader.vue', text: "Failed to search videos.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelDirectoryView.vue', text: "Add a channel", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelPlaylistsTab.vue', text: "Sync Playlists", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelPlaylistsTab.vue', text: "Playlist sync started.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelPlaylistsTab.vue', text: "Failed to start playlist sync.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Start initial sync", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Video visibility updated.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Update failed.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Delete video?", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Permanently delete the video \"{}\"? The local file will be deleted.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Delete video", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Video deleted.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Deletion failed.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Synchronization started.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Synchronization paused.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', text: "Action failed.", reason: 'admin-only control in a shared file (it calls /api/admin routes); the admin side stays English' },
  { file: 'app/spaces/index.ts', text: "Video", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Home", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Shorts", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Channels", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Subscriptions", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Playlists", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Music", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Library", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Discover", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Liked songs", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Recent", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "History", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Podcasts", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/spaces/index.ts', text: "Subscribed", reason: 'English text kept for non-Vue code next to labelKey; the UI renders t(labelKey)' },
  { file: 'app/utils/dayGroups.ts', text: "This week", reason: 'English default of a helper; the pages pass the catalogue words in' },
  { file: 'app/utils/historyDays.ts', text: "Today", reason: 'English default of a helper; the pages pass the catalogue words in' },
  { file: 'app/utils/historyDays.ts', text: "Yesterday", reason: 'English default of a helper; the pages pass the catalogue words in' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Continue watching", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "From your subscriptions", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Recommended for you", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Because you watched", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Browse by category", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Your playlists", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Channels to discover", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "Recently added music", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/homeSectionLabels.ts', text: "New podcast episodes", reason: 'English names for the admin Display preferences form; the home page words rows through the catalogue' },
  { file: 'app/utils/musicVisibilityBadge.ts', text: "Ultra Private", reason: 'visibility badge shown to admins only' },
  { file: 'app/utils/musicVisibilityBadge.ts', text: "Public", reason: 'visibility badge shown to admins only' },
  { file: 'app/utils/musicVisibilityBadge.ts', text: "Private", reason: 'visibility badge shown to admins only' },
  { file: 'app/utils/passwordRules.ts', text: "Password must be at least {} characters long.", reason: 'English text of passwordProblem(), used by the admin users tab; account.vue uses passwordProblemKey' },
  { file: 'app/utils/passwordRules.ts', text: "Password is too long: at most {} bytes (fewer characters if you use accents or emoji).", reason: 'English text of passwordProblem(), used by the admin users tab; account.vue uses passwordProblemKey' },
];

// Files that hold English on purpose, as a whole.
const WHOLE_FILE_ALLOWLIST: Array<{ file: string; reason: string }> = [
  { file: 'app/utils/apiError.ts', reason: 'the English server messages it recognises and maps to catalogue keys; none is displayed as is' },
];

export function boundLiteralHits(file: string, source: string): string[] {
  if (WHOLE_FILE_ALLOWLIST.some(a => a.file === file)) return [];
  const allowed = BOUND_LITERAL_ALLOWLIST.filter(a => a.file === file).map(a => a.text);
  return uiLiteralHits(source, file.endsWith('.vue')).filter(h => !allowed.includes(h.replace(/^line \d+: "(.*)"$/, '$1')));
}

describe('no English literals bound in templates or scripts', () => {
  it('the guard itself detects bound literals (self-test)', () => {
    const vue = (tpl: string, script = '') => `<template>${tpl}</template>\n<script setup lang="ts">\n${script}\n</script>`;
    expect(boundLiteralHits('x.vue', vue('<UiButton :label="\'Foo bar\'" />'))).toHaveLength(1);
    expect(boundLiteralHits('x.vue', vue('<p>{{ ok ? \'Saved\' : \'Not saved\' }}</p>'))).toHaveLength(2);
    expect(boundLiteralHits('x.vue', vue('', "toast.error('Something failed');"))).toHaveLength(1);
    expect(boundLiteralHits('x.vue', vue('', "const o = { message: 'Nope' };"))).toHaveLength(1);
    expect(boundLiteralHits('x.ts', "export const x = { title: 'Delete this?' };")).toHaveLength(1);
    // Not UI text: keys, classes, routes, events, console and error messages, comments.
    expect(boundLiteralHits('x.vue', vue('<div :class="[\'btn btn-primary\', { on: a }]" :title="t(\'a.b\')" @click="emit(\'close\')" />', "navigateTo('/login'); console.error('Logout error:', e); // 'Hello there friend'"))).toEqual([]);
    expect(boundLiteralHits('x.ts', "throw new Error('Something went wrong here'); const k = 'user_prefs';")).toEqual([]);
  });

  it.each(SCANNED)('%s', (file) => {
    const hits = boundLiteralHits(file, readFileSync(join(ROOT, file), 'utf8'));
    expect(hits, `English UI literal in ${file}: ${hits.join('; ')}`).toEqual([]);
  });
});
