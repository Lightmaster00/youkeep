import { defineEventHandler, getQuery } from 'h3';
import { requireUser } from '../../../utils/auth';
import { listUserPlaylists } from '../../../utils/musicUserPlaylists';
import { isValidMediaId } from '../../../../shared/musicPlaylists';

// The caller's own playlists. `?containsTrack=<id>` adds a containsTrack flag
// to each one (used by the "Add to playlist" menu).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  const raw = getQuery(event).containsTrack;
  const containsTrack = isValidMediaId(raw) ? raw : undefined;
  return listUserPlaylists(getDb(), user, containsTrack);
});
