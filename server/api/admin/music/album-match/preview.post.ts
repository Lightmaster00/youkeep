import { defineEventHandler } from 'h3';
import { requireAdmin } from '../../../../utils/auth';
import { getAlbumMatchPreview } from '../../../../utils/albumMatchRunner';

// Read-only counts for the "Match albums" tool.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return getAlbumMatchPreview(getDb());
});
