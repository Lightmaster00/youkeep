import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyAlbumMatch, type ItunesMatch } from '../../server/utils/albumMatch';
import { createTestDb, insertMusicAlbum, insertMusicArtist, insertMusicTrack } from '../helpers/testDb';

let db: Database.Database;

const MATCH: ItunesMatch = {
  collectionId: '617154241',
  collectionName: 'Random Access Memories',
  albumType: 'album',
  artworkUrl: 'https://art/600x600bb.jpg',
  releaseYear: 2013,
  trackNumber: 8,
  genre: 'Dance',
};

const track = (id: string) => db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id) as any;
const albums = () => db.prepare('SELECT * FROM music_albums ORDER BY created_at, id').all() as any[];

beforeEach(() => {
  db = createTestDb();
  insertMusicArtist(db, { id: 'a1', name: 'Daft Punk' });
});

describe('applyAlbumMatch', () => {
  it('creates the album, links the track and fills its empty fields', () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(applyAlbumMatch(db, 't1', MATCH, { now: 1000 })).toBe('matched');
    const [album] = albums();
    expect(album).toMatchObject({
      artist_id: 'a1', title: 'Random Access Memories', release_year: 2013, cover_url: 'https://art/600x600bb.jpg',
      source: 'youtube', external_id: '617154241', album_type: 'album', matched_by: 'itunes',
    });
    expect(track('t1')).toMatchObject({ album_id: album.id, track_number: 8, genre: 'Dance', album_match_status: 'matched', album_match_at: 1000 });
  });

  it('upserts by (artist, collection): a second track reuses the album', () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a1' });
    applyAlbumMatch(db, 't1', MATCH);
    applyAlbumMatch(db, 't2', { ...MATCH, trackNumber: 3 });
    expect(albums()).toHaveLength(1);
    expect(track('t2').album_id).toBe(track('t1').album_id);
    expect(track('t2').track_number).toBe(3);
  });

  it('the same collection under another artist is another album', () => {
    insertMusicArtist(db, { id: 'a2', name: 'Other' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    insertMusicTrack(db, { id: 't2', artistId: 'a2' });
    applyAlbumMatch(db, 't1', MATCH);
    applyAlbumMatch(db, 't2', MATCH);
    expect(albums()).toHaveLength(2);
  });

  it('only fills the empty fields of an existing album and track', () => {
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'Admin Title', releaseYear: 1999 });
    db.prepare("UPDATE music_albums SET external_id = ?, cover_url = 'https://mine.jpg', album_type = 'ep' WHERE id = 'al1'").run(MATCH.collectionId);
    insertMusicTrack(db, { id: 't1', artistId: 'a1', trackNumber: 2, genre: 'House' });
    applyAlbumMatch(db, 't1', MATCH);
    expect(albums()).toHaveLength(1);
    expect(albums()[0]).toMatchObject({ title: 'Admin Title', release_year: 1999, cover_url: 'https://mine.jpg', album_type: 'ep', matched_by: 'itunes' });
    expect(track('t1')).toMatchObject({ album_id: 'al1', track_number: 2, genre: 'House' });
  });

  it('fills a missing cover on an existing album', () => {
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1' });
    db.prepare('UPDATE music_albums SET external_id = ? WHERE id = ?').run(MATCH.collectionId, 'al1');
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    applyAlbumMatch(db, 't1', MATCH);
    expect(albums()[0]).toMatchObject({ cover_url: MATCH.artworkUrl, release_year: 2013, album_type: 'album' });
  });

  it('adopts an album of the same name that has no collection yet instead of duplicating it', () => {
    insertMusicAlbum(db, { id: 'al1', artistId: 'a1', title: 'random access memories' });
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    applyAlbumMatch(db, 't1', MATCH);
    expect(albums()).toHaveLength(1);
    expect(albums()[0]).toMatchObject({ id: 'al1', external_id: MATCH.collectionId, title: 'random access memories' });
  });

  it('never changes a manual track or one that already has an album', () => {
    insertMusicAlbum(db, { id: 'yt', artistId: 'a1', title: 'From yt-dlp' });
    insertMusicTrack(db, { id: 'manual', artistId: 'a1', albumMatchStatus: 'manual' });
    insertMusicTrack(db, { id: 'ytdlp', artistId: 'a1', albumId: 'yt' });
    expect(applyAlbumMatch(db, 'manual', MATCH)).toBe('skipped');
    expect(applyAlbumMatch(db, 'ytdlp', MATCH)).toBe('skipped');
    expect(track('manual')).toMatchObject({ album_id: null, album_match_status: 'manual', album_match_at: null });
    // The yt-dlp album track is marked manual the first time it is seen.
    expect(track('ytdlp')).toMatchObject({ album_id: 'yt', album_match_status: 'manual' });
    expect(albums()).toHaveLength(1);
  });

  it('marks a track without a match as unmatched, and only retries it when asked', () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    expect(applyAlbumMatch(db, 't1', null, { now: 5 })).toBe('unmatched');
    expect(track('t1')).toMatchObject({ album_id: null, album_match_status: 'unmatched', album_match_at: 5 });
    expect(applyAlbumMatch(db, 't1', MATCH)).toBe('skipped');
    expect(applyAlbumMatch(db, 't1', MATCH, { allowUnmatched: true })).toBe('matched');
  });

  it('never re-matches a matched track, and skips a missing one', () => {
    insertMusicTrack(db, { id: 't1', artistId: 'a1' });
    applyAlbumMatch(db, 't1', MATCH);
    expect(applyAlbumMatch(db, 't1', { ...MATCH, collectionId: '2', collectionName: 'Other' }, { allowUnmatched: true })).toBe('skipped');
    expect(albums()).toHaveLength(1);
    expect(applyAlbumMatch(db, 'missing', MATCH)).toBe('skipped');
  });
});
