import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import handler from '../../server/api/home/feed.get';
import {
  createTestDb, insertUser, insertSession, insertChannel, insertVideo, insertSetting, insertUserPreferences,
  insertMusicArtist, insertMusicAlbum, insertMusicTrack, insertPodcastShow, insertPodcastEpisode,
  mockEvent, sessionCookie,
} from '../helpers/testDb';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  (globalThis as any).getDb = () => db;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return mockEvent(sessionCookie(`sess-${userId}`));
}
const guestEvent = () => mockEvent();
const setAdminDefaults = (prefs: object) => insertSetting(db, { key: 'display_defaults', value: JSON.stringify(prefs) });
const sectionIds = (r: any) => r.sections.map((s: any) => s.id);
const section = (r: any, id: string) => r.sections.find((s: any) => s.id === id);

function seedMusic(n: number, artistId = 'a1', visibility = 'public') {
  insertMusicArtist(db, { id: artistId, name: `Artist ${artistId}`, visibility });
  for (let i = 0; i < n; i++) {
    insertMusicTrack(db, {
      id: `${artistId}t${i}`, artistId, duration: 200,
      localFilePath: `/downloads-music/${artistId}t${i}.m4a`, createdAt: Date.now() - i * 1000,
    });
  }
}

function seedEpisodes(n: number, showId = 's1', visibility = 'public') {
  insertPodcastShow(db, { id: showId, title: `Show ${showId}`, visibility });
  for (let i = 0; i < n; i++) {
    insertPodcastEpisode(db, {
      id: `${showId}e${i}`, showId,
      localFilePath: `/downloads-podcasts/${showId}e${i}.mp3`, createdAt: Date.now() - i * 1000,
    });
  }
}

describe('recentMusic / newEpisodes sections', () => {
  it('are absent by default (opt-in) even when music and episodes exist', async () => {
    seedMusic(3);
    seedEpisodes(3);
    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).not.toContain('recentMusic');
    expect(sectionIds(r)).not.toContain('newEpisodes');
  });

  it('appear in the configured order with card-ready items, newest first', async () => {
    insertChannel(db, { id: 'c1' });
    insertVideo(db, { id: 'v1', channelId: 'c1' });
    insertMusicArtist(db, { id: 'a1', name: 'The Band' });
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'First Album' });
    db.prepare("UPDATE music_albums SET cover_url = 'https://img/cover.jpg' WHERE id = 'al1'").run();
    insertMusicTrack(db, { id: 'old', artistId: 'a1', albumId: 'al1', localFilePath: '/m/old.m4a', createdAt: 1000 });
    insertMusicTrack(db, { id: 'new', artistId: 'a1', albumId: 'al1', localFilePath: '/m/new.m4a', createdAt: 2000 });
    insertPodcastShow(db, { id: 's1', title: 'The Show' });
    db.prepare("UPDATE podcast_shows SET cover_url = 'https://img/show.jpg' WHERE id = 's1'").run();
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', localFilePath: '/p/e1.mp3', createdAt: 1000 });
    insertPodcastEpisode(db, { id: 'e2', showId: 's1', localFilePath: '/p/e2.mp3', createdAt: 2000 });
    db.prepare("UPDATE podcast_episodes SET pub_date = 'Tue, 06 Oct 2026 10:00:00 GMT' WHERE id = 'e2'").run();
    setAdminDefaults({ homeHero: false, homeSections: ['newEpisodes', 'recent', 'recentMusic'] });

    const r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['newEpisodes', 'recent', 'recentMusic']);

    const music = section(r, 'recentMusic');
    expect(music.title).toBe('Recently added music');
    expect(music.tracks.map((t: any) => t.id)).toEqual(['new', 'old']);
    expect(music.tracks[0]).toMatchObject({
      id: 'new', title: 'Track new', artist_id: 'a1', artist_name: 'The Band',
      album_title: 'First Album', album_cover_url: 'https://img/cover.jpg', local_file_path: '/m/new.m4a',
    });

    const episodes = section(r, 'newEpisodes');
    expect(episodes.title).toBe('New podcast episodes');
    expect(episodes.episodes.map((e: any) => e.id)).toEqual(['e2', 'e1']);
    expect(episodes.episodes[0]).toMatchObject({
      id: 'e2', title: 'Episode e2', show_id: 's1', show_title: 'The Show',
      show_cover_url: 'https://img/show.jpg', pub_date: 'Tue, 06 Oct 2026 10:00:00 GMT', local_file_path: '/p/e2.mp3',
    });
  });

  it('honour rowSize', async () => {
    seedMusic(15);
    seedEpisodes(15);
    setAdminDefaults({ homeSections: ['recentMusic', 'newEpisodes'], rowSize: 10 });
    const r: any = await handler(guestEvent());
    expect(section(r, 'recentMusic').tracks).toHaveLength(10);
    expect(section(r, 'newEpisodes').episodes).toHaveLength(10);
  });

  it('are omitted when there is nothing playable (pending downloads only)', async () => {
    insertMusicArtist(db, { id: 'a1' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1', downloadStatus: 'pending' });
    insertPodcastShow(db, { id: 's1' });
    insertPodcastEpisode(db, { id: 'e1', showId: 's1', downloadStatus: 'pending' });
    setAdminDefaults({ homeSections: ['recentMusic', 'newEpisodes'] });
    const r: any = await handler(guestEvent());
    expect(r.sections).toEqual([]);
  });

  it('are omitted when their module is off', async () => {
    seedMusic(3);
    seedEpisodes(3);
    setAdminDefaults({ homeSections: ['recentMusic', 'newEpisodes'] });
    insertSetting(db, { key: 'music_module_enabled', value: '0' });
    let r: any = await handler(guestEvent());
    expect(sectionIds(r)).toEqual(['newEpisodes']);
    insertSetting(db, { key: 'podcasts_module_enabled', value: '0' });
    r = await handler(guestEvent());
    expect(sectionIds(r)).toEqual([]);
  });

  it('follow the music and podcast visibility rules', async () => {
    seedMusic(1, 'pub', 'public');
    seedMusic(1, 'priv', 'private');
    seedMusic(1, 'hid', 'hidden');
    seedEpisodes(1, 'spub', 'public');
    seedEpisodes(1, 'spriv', 'private');
    seedEpisodes(1, 'shid', 'hidden');
    setAdminDefaults({ homeSections: ['recentMusic', 'newEpisodes'] });
    const trackIds = (r: any) => section(r, 'recentMusic').tracks.map((t: any) => t.id).sort();
    const episodeIds = (r: any) => section(r, 'newEpisodes').episodes.map((e: any) => e.id).sort();

    const guest: any = await handler(guestEvent());
    expect(trackIds(guest)).toEqual(['pubt0']);
    expect(episodeIds(guest)).toEqual(['spube0']);

    const user: any = await handler(loginAs('u1'));
    expect(trackIds(user)).toEqual(['privt0', 'pubt0']);
    expect(episodeIds(user)).toEqual(['sprive0', 'spube0']);

    const admin: any = await handler(loginAs('boss', 'admin'));
    expect(trackIds(admin)).toEqual(['hidt0', 'privt0', 'pubt0']);
    expect(episodeIds(admin)).toEqual(['shide0', 'sprive0', 'spube0']);
  });

  it('a user override can opt in while the instance default stays video only', async () => {
    seedMusic(2);
    const event = loginAs('u1');
    insertUserPreferences(db, { userId: 'u1', data: JSON.stringify({ homeSections: ['recentMusic'] }) });
    const r: any = await handler(event);
    expect(sectionIds(r)).toEqual(['recentMusic']);
  });
});
