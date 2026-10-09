import { defineEventHandler } from 'h3';
import { requireAdmin } from '../../../../utils/auth';
import { cancelAlbumMatchRun } from '../../../../utils/albumMatchRunner';

// Stops the run after the track currently being looked up.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return { cancelling: cancelAlbumMatchRun() };
});
