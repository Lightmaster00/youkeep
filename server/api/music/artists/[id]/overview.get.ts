import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../../../utils/auth';
import { buildArtistOverview, requireMusicArtistAccess } from '../../../../utils/musicArtistPage';

// Overview tab of the artist page: popular tracks, latest release, albums and
// singles/EPs, and counts.
export default defineEventHandler(async (event) => {
  const db = getDb();
  const artist = await requireMusicArtistAccess(db, event.context.params?.id, event);
  const session = await getUserFromSession(event);
  return buildArtistOverview(db, artist, session?.id ?? null);
});
