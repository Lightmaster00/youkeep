import { defineEventHandler, getQuery } from 'h3';
import { getUserFromSession } from '../../../../utils/auth';
import { discoverInt } from '../../../../utils/musicDiscover';
import { listArtistSongs, parseSongSort, requireMusicArtistAccess } from '../../../../utils/musicArtistPage';

// Songs tab of the artist page: every completed track of the artist, sorted
// (popular, newest, oldest or title) and paged.
export default defineEventHandler(async (event) => {
  const db = getDb();
  const artist = await requireMusicArtistAccess(db, event.context.params?.id, event);
  const session = await getUserFromSession(event);
  const query = getQuery(event);
  return listArtistSongs(db, artist.id, {
    sort: parseSongSort(query.sort),
    userId: session?.id ?? null,
    limit: discoverInt(query.limit, 50, 1, 200),
    offset: discoverInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  });
});
