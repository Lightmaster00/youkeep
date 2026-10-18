import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { canAccessPodcastShow, canAccessPodcastEpisode, getUserFromSession } from '../../server/utils/auth';
import { videoVisibilitySql } from '../../server/utils/videoAccess';
import videosHandler from '../../server/api/videos/index.get';
import feedHandler from '../../server/api/home/feed.get';
import {
  assertInTmp, insertUser, insertSession, insertChannel, insertVideo, grantChannelAccess,
  insertPodcastShow, insertPodcastEpisode, mockEvent, sessionCookie,
} from '../helpers/testDb';

// The list-side twin of canAccessVideo (videoVisibilitySql) and the podcast
// access checks. Every case here is one a single-clause mutation of the
// production code used to survive.

// The real schema (FTS tables, every video column the list routes select).
const { openDatabase } = await vi.importActual<typeof import('../../server/utils/db')>('../../server/utils/db');

let db: Database.Database;
let dir: string;

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-visibility-'));
  assertInTmp(dir);
  db = openDatabase(path.join(dir, 'youkeep.db'));
  (globalThis as any).getDb = () => db;
  // /api/videos uses the Nitro auto-import.
  (globalThis as any).getUserFromSession = getUserFromSession;
});

function loginAs(userId: string, role: 'admin' | 'user' = 'user', path = '/') {
  insertUser(db, { id: userId, role });
  insertSession(db, { id: `sess-${userId}`, userId });
  return mockEvent(sessionCookie(`sess-${userId}`), { path });
}
const guest = (path = '/') => mockEvent(undefined, { path });

/** Every channel/video visibility combination, one public video per channel tier plus restricted videos. */
function seedLibrary() {
  insertChannel(db, { id: 'pub', visibility: 'public', title: 'Zebra pub' });
  insertChannel(db, { id: 'priv', visibility: 'private', title: 'Zebra priv' });
  insertChannel(db, { id: 'ultra', visibility: 'ultra_private', title: 'Zebra ultra' });
  insertChannel(db, { id: 'ultra2', visibility: 'ultra_private', title: 'Zebra ultra2' });
  insertVideo(db, { id: 'v-pub-pub', channelId: 'pub', visibility: 'public', title: 'zebra a' });
  insertVideo(db, { id: 'v-pub-priv', channelId: 'pub', visibility: 'private', title: 'zebra b' });
  insertVideo(db, { id: 'v-pub-ultra', channelId: 'pub', visibility: 'ultra_private', title: 'zebra c' });
  insertVideo(db, { id: 'v-priv-pub', channelId: 'priv', visibility: 'public', title: 'zebra d' });
  insertVideo(db, { id: 'v-ultra-pub', channelId: 'ultra', visibility: 'public', title: 'zebra e' });
  insertVideo(db, { id: 'v-ultra2-pub', channelId: 'ultra2', visibility: 'public', title: 'zebra f' });
}

function visibleIds(viewer: { id: string; role: 'admin' | 'user' } | null): string[] {
  const vis = videoVisibilitySql(viewer);
  return (db.prepare(`SELECT v.id FROM videos v JOIN channels c ON c.id = v.channel_id WHERE ${vis.sql} ORDER BY v.id`)
    .all(...vis.params) as { id: string }[]).map((r) => r.id);
}

describe('videoVisibilitySql', () => {
  beforeEach(seedLibrary);

  it('a guest sees only public videos of public channels', () => {
    expect(visibleIds(null)).toEqual(['v-pub-pub']);
  });

  it('a member sees public/private videos of public/private channels, not ultra_private ones', () => {
    insertUser(db, { id: 'm', role: 'user' });
    expect(visibleIds({ id: 'm', role: 'user' })).toEqual(['v-priv-pub', 'v-pub-priv', 'v-pub-pub']);
  });

  it("a member's own channel grant opens that channel (even its ultra_private videos)", () => {
    insertUser(db, { id: 'm', role: 'user' });
    grantChannelAccess(db, 'm', 'ultra');
    insertVideo(db, { id: 'v-ultra-ultra', channelId: 'ultra', visibility: 'ultra_private' });
    expect(visibleIds({ id: 'm', role: 'user' })).toEqual(['v-priv-pub', 'v-pub-priv', 'v-pub-pub', 'v-ultra-pub', 'v-ultra-ultra']);
  });

  it("another user's grant opens nothing for this member", () => {
    insertUser(db, { id: 'm', role: 'user' });
    insertUser(db, { id: 'other', role: 'user' });
    grantChannelAccess(db, 'other', 'ultra2');
    expect(visibleIds({ id: 'm', role: 'user' })).not.toContain('v-ultra2-pub');
    expect(visibleIds({ id: 'other', role: 'user' })).toContain('v-ultra2-pub');
  });

  it('an admin sees everything', () => {
    expect(visibleIds({ id: 'a', role: 'admin' })).toHaveLength(6);
  });
});

describe('list routes apply the same visibility', () => {
  beforeEach(seedLibrary);

  const listIds = async (event: any) => ((await videosHandler(event)) as any).videos.map((v: any) => v.id).sort();
  const feedIds = async (event: any) => {
    const r: any = await feedHandler(event);
    const ids = new Set<string>();
    const walk = (x: any) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') {
        if (typeof x.id === 'string' && 'channel_id' in x) ids.add(x.id);
        Object.values(x).forEach(walk);
      }
    };
    walk(r);
    return [...ids].sort();
  };

  it('/api/videos: a guest never gets a public video of a private or ultra_private channel', async () => {
    expect(await listIds(guest('/api/videos'))).toEqual(['v-pub-pub']);
  });

  it('/api/videos?search=: a guest search obeys the same rule', async () => {
    expect(await listIds(guest('/api/videos?search=zebra'))).toEqual(['v-pub-pub']);
  });

  it('/api/videos: a member gets their own grant and not another member\'s', async () => {
    insertUser(db, { id: 'other', role: 'user' });
    grantChannelAccess(db, 'other', 'ultra2');
    const event = loginAs('m', 'user', '/api/videos');
    grantChannelAccess(db, 'm', 'ultra');
    expect(await listIds(event)).toEqual(['v-priv-pub', 'v-pub-priv', 'v-pub-pub', 'v-ultra-pub']);
  });

  it('/api/home/feed: a guest sees only the public video of the public channel', async () => {
    expect(await feedIds(guest('/api/home/feed'))).toEqual(['v-pub-pub']);
  });

  it('/api/home/feed: a member sees their own grant, not another member\'s', async () => {
    insertUser(db, { id: 'other', role: 'user' });
    grantChannelAccess(db, 'other', 'ultra2');
    const event = loginAs('m', 'user', '/api/home/feed');
    grantChannelAccess(db, 'm', 'ultra');
    const ids = await feedIds(event);
    expect(ids).toContain('v-ultra-pub');
    expect(ids).not.toContain('v-ultra2-pub');
    expect(ids).not.toContain('v-pub-ultra');
  });
});

describe('podcast access matrix', () => {
  type Who = 'guest' | 'member' | 'admin';
  const eventFor = (who: Who) => (who === 'guest' ? guest() : loginAs(who, who === 'admin' ? 'admin' : 'user'));

  // [visibility, guest, member, admin]
  const matrix: [string, boolean, boolean, boolean][] = [
    ['public', true, true, true],
    ['private', false, true, true],
    ['ultra_private', false, false, true],
    // No CHECK constraint on podcast_shows.visibility: an unknown value fails closed.
    ['secret-new-tier', false, false, true],
  ];

  for (const [visibility, g, m, a] of matrix) {
    for (const [who, expected] of [['guest', g], ['member', m], ['admin', a]] as [Who, boolean][]) {
      it(`show '${visibility}' for a ${who}: ${expected ? 'allowed' : 'refused'}`, async () => {
        insertPodcastShow(db, { id: 's', visibility });
        expect(await canAccessPodcastShow('s', eventFor(who))).toBe(expected);
      });

      it(`episode of a '${visibility}' show for a ${who}: ${expected ? 'allowed' : 'refused'}`, async () => {
        insertPodcastShow(db, { id: 's', visibility });
        insertPodcastEpisode(db, { id: 'e', showId: 's' });
        expect(await canAccessPodcastEpisode('e', eventFor(who))).toBe(expected);
      });
    }
  }

  it('a missing show or episode is refused, even to an admin', async () => {
    expect(await canAccessPodcastShow('nope', loginAs('a', 'admin'))).toBe(false);
    expect(await canAccessPodcastEpisode('nope', loginAs('b', 'admin'))).toBe(false);
  });
});
