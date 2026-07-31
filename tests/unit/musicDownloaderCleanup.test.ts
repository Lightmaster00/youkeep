import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { cleanupPartialMusicFiles, getMusicDownloadsDir } from '../../server/utils/musicDownloader';

// cleanupPartialMusicFiles looks up the artist's name in the DB to build the
// folder name, falling back to the raw artistId when no matching artist row
// exists. Using a unique nonexistent artistId as the folder name means these
// tests need no DB fixtures and can't collide with other tests or real data.
let artistId: string;
let artistDir: string;

beforeEach(() => {
  artistId = `test-cleanup-artist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  artistDir = path.join(getMusicDownloadsDir(), artistId);
  fs.mkdirSync(artistDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(artistDir, { recursive: true, force: true });
});

describe('cleanupPartialMusicFiles', () => {
  it('deletes everything matching the prefix when no newerThan is given', () => {
    fs.writeFileSync(path.join(artistDir, 't1.opus'), 'x');
    fs.writeFileSync(path.join(artistDir, 't1.mp4.part'), 'x');

    cleanupPartialMusicFiles('t1', artistId);

    expect(fs.existsSync(path.join(artistDir, 't1.opus'))).toBe(false);
    expect(fs.existsSync(path.join(artistDir, 't1.mp4.part'))).toBe(false);
  });

  it('protects a file older than newerThan and deletes a file created after it', () => {
    const oldFile = path.join(artistDir, 't1.opus');
    fs.writeFileSync(oldFile, 'x');
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const cutoff = Date.now();

    const newFile = path.join(artistDir, 't1.mp4.part');
    fs.writeFileSync(newFile, 'x');

    cleanupPartialMusicFiles('t1', artistId, { newerThan: cutoff });

    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.existsSync(newFile)).toBe(false);
  });

  it('does not touch files belonging to a different track id sharing a prefix', () => {
    fs.writeFileSync(path.join(artistDir, 'abc.opus'), 'x');
    fs.writeFileSync(path.join(artistDir, 'abc123.opus'), 'x');

    cleanupPartialMusicFiles('abc', artistId);

    expect(fs.existsSync(path.join(artistDir, 'abc.opus'))).toBe(false);
    expect(fs.existsSync(path.join(artistDir, 'abc123.opus'))).toBe(true);
  });
});
