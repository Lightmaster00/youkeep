import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  videoBaseName, buildVideoPaths, isContained, idFromVideoFolder, isNewLayoutUrl, decodeUrlSegments, candidateVideoDirs, VIDEO_BASENAME_MAX_BYTES,
} from '../../server/utils/videoPaths';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('videoBaseName', () => {
  it('cleans the title and always ends with the bracketed id', () => {
    expect(videoBaseName('  Pourquoi le ciel / la mer: "bleus"?  ', 'abc')).toBe('Pourquoi le ciel _ la mer_ _bleus__ [abc]');
    expect(videoBaseName('a\tb\n\nc\u0007d', 'x')).toBe('a b c_d [x]');
    expect(videoBaseName('...hidden. ', 'x')).toBe('hidden [x]');
    expect(videoBaseName('', 'x')).toBe('x [x]');
    expect(videoBaseName(null, 'x')).toBe('x [x]');
    expect(videoBaseName(' .. ', 'x')).toBe('x [x]');
    expect(videoBaseName('Same', 'a')).not.toBe(videoBaseName('Same', 'b'));
  });

  it('truncates to 120 bytes without splitting a multi-byte character', () => {
    const id = 'dQw4w9WgXcQ';
    for (const title of ['a'.repeat(300), 'é'.repeat(300), '😀'.repeat(100), 'ab' + '😀'.repeat(100)]) {
      const name = videoBaseName(title, id);
      expect(bytes(name)).toBeLessThanOrEqual(VIDEO_BASENAME_MAX_BYTES);
      expect(name.endsWith(` [${id}]`)).toBe(true);
      // A split surrogate pair would not survive a UTF-8 round trip.
      expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
      expect(name).not.toContain('\uFFFD');
    }
    // 106-byte budget: 'ab' (2) + 26 emoji (104) fits exactly, a 27th would not.
    expect(videoBaseName('ab' + '😀'.repeat(100), id)).toBe(`ab${'😀'.repeat(26)} [${id}]`);
    expect(bytes(videoBaseName('é'.repeat(300), id))).toBe(120);
  });
});

describe('buildVideoPaths', () => {
  it('builds the folder, an escaped yt-dlp template and percent-encoded URLs', () => {
    const p = buildVideoPaths({ baseDir: '/data/videos', channelFolder: 'My Chan', title: 'Ep #3: 100% [live]', id: 'id1' });
    expect(p.baseName).toBe('Ep #3_ 100% [live] [id1]');
    expect(p.dir).toBe(path.join('/data/videos', 'My Chan', 'Ep #3_ 100% [live] [id1]'));
    expect(p.outputTemplate).toBe(path.join('/data/videos', 'My Chan', 'Ep #3_ 100%% [live] [id1]', 'Ep #3_ 100%% [live] [id1]') + '.%(ext)s');
    const folder = 'Ep%20%233_%20100%25%20%5Blive%5D%20%5Bid1%5D';
    expect(p.videoUrlFor('mp4')).toBe(`/downloads/My%20Chan/${folder}/${folder}.mp4`);
    expect(p.thumbUrlFor('jpg')).toBe(`/downloads/My%20Chan/${folder}/${folder}.jpg`);
    expect(isNewLayoutUrl(p.videoUrlFor('mp4'), 'id1')).toBe(true);
    expect(isNewLayoutUrl(p.videoUrlFor('mp4'), 'other')).toBe(false);
    expect(isNewLayoutUrl('/downloads/My Chan/id1.mp4', 'id1')).toBe(false);
    expect(isNewLayoutUrl(null, 'id1')).toBe(false);
  });

  it('rejects unsafe or malformed URL segments', () => {
    expect(decodeUrlSegments(['My%20Chan', 'a%20%5Bx%5D', 'f.mp4'])).toEqual(['My Chan', 'a [x]', 'f.mp4']);
    for (const bad of [['..', 'b', 'c'], ['a', '..%2Fb', 'c'], ['a', 'b%5Cc', 'd'], ['a', '%E0%A4%A', 'c'], ['a', '', 'c'], ['a', 'b%00', 'c']]) {
      expect(decodeUrlSegments(bad)).toBeNull();
    }
  });

  it('also looks directly in the base folder when it is named like the channel (doubled folder)', () => {
    expect(candidateVideoDirs('/m/Dup', 'Dup', 'T [1]')).toEqual([path.resolve('/m/Dup/Dup/T [1]'), path.resolve('/m/Dup/T [1]')]);
    expect(candidateVideoDirs('/m/videos', 'Dup', 'T [1]')).toEqual([path.resolve('/m/videos/Dup/T [1]')]);
  });

  it('keeps the disk folder inside the base folder whatever the channel folder contains', () => {
    for (const channelFolder of ['a/../b', '../x', 'x/y', '..', '']) {
      const p = buildVideoPaths({ baseDir: '/data/videos', channelFolder, title: 'T', id: 'i' });
      expect(isContained('/data/videos', p.dir)).toBe(true);
      expect(path.dirname(path.dirname(p.dir))).toBe(path.resolve('/data/videos'));
      expect(candidateVideoDirs('/data/videos', channelFolder, p.baseName).every((d) => isContained('/data/videos', d))).toBe(true);
      expect(p.urlDir.split('/')).toHaveLength(4);
      expect(decodeURIComponent(p.urlDir.split('/')[2]!)).toBe(path.basename(path.dirname(p.dir)));
    }
  });

  it('matches ids that are cleaned or contain brackets', () => {
    const p = buildVideoPaths({ baseDir: '/b', channelFolder: 'C', title: 'T', id: 'a/b[c]' });
    expect(isNewLayoutUrl(p.videoUrlFor('mp4'), 'a/b[c]')).toBe(true);
    expect(idFromVideoFolder(p.baseName)).toBe('a_b[c]');
    expect(idFromVideoFolder('T [x]')).toBe('x');
    expect(idFromVideoFolder('no id')).toBeNull();
  });
});

describe('isContained', () => {
  it('only accepts strictly nested paths', () => {
    expect(isContained('/a', '/a/b/c')).toBe(true);
    expect(isContained('/a', '/a/..b')).toBe(true);
    expect(isContained('/a', '/a')).toBe(false);
    expect(isContained('/a', '/a/../b')).toBe(false);
    expect(isContained('/a', '/ab')).toBe(false);
  });
});
