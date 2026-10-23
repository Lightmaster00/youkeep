import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

// Hard-coded text guard: migrated files must take every visible string from the catalogue.
const MIGRATED = [
  'app/layouts/default.vue',
  'app/components/SidebarPanels.vue',
  'app/pages/login.vue',
  'app/pages/account.vue',
  'app/error.vue',
  'app/components/LanguageSelect.vue',
  // Video discovery (batch A). The admin-only ChannelCategoryEditor, ChannelSettingsDrawer and
  // ChannelStatsPanel stay English on purpose (see englishOnly.test.ts) and are not listed.
  'app/pages/index.vue',
  'app/pages/subscriptions.vue',
  'app/pages/channels.vue',
  'app/pages/search.vue',
  'app/components/home/HomeChannelCard.vue',
  'app/components/home/HomePlaylistCard.vue',
  'app/components/home/HomeRow.vue',
  'app/components/home/HomeSection.vue',
  'app/components/HomeMediaRow.vue',
  'app/components/VideoCard.vue',
  'app/components/MediaFrame.vue',
  'app/components/DiscoverRow.vue',
  'app/components/EmptyState.vue',
  'app/components/subscriptions/SubscriptionsChannelCard.vue',
  'app/components/subscriptions/SubscriptionsChipBar.vue',
  'app/components/subscriptions/SubscriptionsLatest.vue',
  'app/components/channels/CategoryChip.vue',
  'app/components/channels/CategoryChipBar.vue',
  'app/components/channels/ChannelDetailHeader.vue',
  'app/components/channels/ChannelDirectoryCard.vue',
  'app/components/channels/ChannelDirectoryView.vue',
  'app/components/channels/ChannelPlaylistsTab.vue',
  'app/components/channels/ChannelVideoGrid.vue',
  // Watch, playlists and Shorts (batch B).
  'app/pages/watch/[id].vue',
  'app/pages/playlists/index.vue',
  'app/pages/playlists/[id].vue',
  'app/pages/shorts.vue',
  'app/components/VideoPlayer.vue',
  'app/components/VideoDropdownMenu.vue',
  'app/components/SaveToPlaylistModal.vue',
  'app/components/AddToPlaylistMenu.vue',
  'app/components/ReportVideoModal.vue',
  'app/components/PlaylistCoverMosaic.vue',
  'app/components/BaseModal.vue',
  'app/components/ClipboardFallbackHost.vue',
  // Music (batch C). The admin-only MusicTrackEditModal and MusicAlbumEditModal (they save through
  // /api/admin routes) stay English on purpose (see englishOnly.test.ts) and are not listed.
  'app/pages/music/index.vue',
  'app/pages/music/discover.vue',
  'app/pages/music/liked.vue',
  'app/pages/music/recent.vue',
  'app/pages/music/history.vue',
  'app/pages/music/genre/[name].vue',
  'app/pages/music/album/[id].vue',
  'app/pages/music/playlists/index.vue',
  'app/pages/music/playlists/[id].vue',
  'app/components/MusicMiniPlayer.vue',
  'app/components/MusicArtistPage.vue',
  'app/components/MusicArtistHeader.vue',
  'app/components/MusicArtistOverview.vue',
  'app/components/MusicArtistSongs.vue',
  'app/components/MusicArtistTile.vue',
  'app/components/MusicTrackList.vue',
  'app/components/MusicTrackCard.vue',
  'app/components/MusicTrackActions.vue',
  'app/components/MusicTrackExtras.vue',
  'app/components/MusicAlbumTile.vue',
  'app/components/MusicCollectionHeader.vue',
  'app/components/MusicMixTile.vue',
  'app/components/MusicGenreTile.vue',
  'app/components/TrackLikeButton.vue',
];

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
  // Admin-only controls inside shared pages: the admin side stays English (englishOnly.test.ts).
  { file: 'app/components/channels/ChannelDetailHeader.vue', attr: 'text "Tracking options"', reason: 'admin-only button' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', attr: 'title="Copy share link"', reason: 'admin-only thumbnail action' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', attr: 'title="Edit visibility"', reason: 'admin-only thumbnail action' },
  { file: 'app/components/channels/ChannelVideoGrid.vue', attr: 'title="Delete video"', reason: 'admin-only thumbnail action' },
  // Admin-only controls inside shared music pages.
  { file: 'app/pages/music/album/[id].vue', attr: 'text "Edit album"', reason: 'admin-only button (opens the admin album editor)' },
  { file: 'app/components/MusicTrackExtras.vue', attr: 'title="Edit"', reason: 'admin-only row button (opens the admin track editor)' },
  { file: 'app/components/MusicTrackExtras.vue', attr: 'aria-label="Edit track"', reason: 'admin-only row button (opens the admin track editor)' },
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

  it.each(MIGRATED)('%s', (file) => {
    const allowed = LITERAL_ALLOWLIST.filter(a => a.file === file).map(a => a.attr);
    const hits = hardCodedText(readFileSync(join(ROOT, file), 'utf8')).filter(h => !allowed.includes(h));
    expect(hits, `hard-coded text in ${file}: ${hits.join('; ')}`).toEqual([]);
  });
});
