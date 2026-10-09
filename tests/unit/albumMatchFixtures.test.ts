import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { searchItunesSong, type ItunesClient } from '../../server/utils/albumMatch';

// Real iTunes Search API answers, recorded once (2026-10-09) and trimmed to the
// fields the matcher reads. No test here touches the network.
const FIXTURES = path.resolve(__dirname, '../fixtures/itunes');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')).results as any[];

const SEARCHES: Record<string, string> = {
  'Eminem Lose Yourself': 'search-eminem-lose-yourself',
  'Eminem The Real Slim Shady': 'search-eminem-the-real-slim-shady',
  'Eminem Rap God': 'search-eminem-rap-god',
  'Daft Punk Around the World': 'search-daft-punk-around-the-world',
  'Daft Punk Some Completely Unknown Home Recording 2019': 'search-daft-punk-unknown-home-recording',
};

function recordedClient() {
  const calls = { search: [] as string[], lookup: [] as string[][] };
  const client: ItunesClient = {
    search: async (term) => {
      calls.search.push(term);
      const fixture = SEARCHES[term];
      if (!fixture) throw new Error(`No recorded search for "${term}"`);
      return load(fixture);
    },
    lookup: async (ids) => {
      calls.lookup.push(ids);
      return load('lookup-collections').filter((c) => ids.includes(String(c.collectionId)));
    },
  };
  return { client, calls };
}

describe('album matching against recorded iTunes answers', () => {
  it.each([
    ['Eminem', 'Eminem - Lose Yourself [HD] (Official Video)', { collectionId: '1440903339', collectionName: '8 Mile (Music from and Inspired By the Motion Picture)', releaseYear: 2002, albumType: 'album' }],
    ['Eminem', 'Eminem - The Real Slim Shady (Official Video)', { collectionId: '1440906504', collectionName: 'The Marshall Mathers LP', releaseYear: 2000, albumType: 'album' }],
    ['Eminem', 'Eminem - Rap God (Explicit)', { collectionId: '1440858761', collectionName: 'The Marshall Mathers LP2', releaseYear: 2013, albumType: 'album' }],
    ['Daft Punk', 'Daft Punk - Around the World', { collectionId: '696884422', collectionName: 'Homework', releaseYear: 1997, albumType: 'album' }],
  ])('%s: "%s" goes to the original album', async (artist, title, expected) => {
    const { client, calls } = recordedClient();
    const match = await searchItunesSong(artist, title, client);
    expect(match).toMatchObject(expected);
    expect(match!.trackNumber).toBeGreaterThan(0);
    expect(match!.artworkUrl).toContain('600x600bb');
    expect(calls.search).toHaveLength(1);
    // At most one lookup request, for at most 4 collections.
    expect(calls.lookup.length).toBeLessThanOrEqual(1);
    for (const ids of calls.lookup) expect(ids.length).toBeLessThanOrEqual(4);
  });

  it('an unknown home recording stays unmatched, without a lookup', async () => {
    const { client, calls } = recordedClient();
    expect(await searchItunesSong('Daft Punk', 'Some Completely Unknown Home Recording 2019', client)).toBeNull();
    expect(calls.lookup).toEqual([]);
  });

  it('without the collection lookup, Lose Yourself would go to a later compilation', async () => {
    const { client } = recordedClient();
    const noLookup: ItunesClient = { search: client.search, lookup: async () => [] };
    expect((await searchItunesSong('Eminem', 'Eminem - Lose Yourself [HD] (Official Video)', noLookup))!.collectionName).toBe('SHADYXV');
  });
});
