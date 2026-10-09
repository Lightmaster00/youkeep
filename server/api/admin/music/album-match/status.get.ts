import { defineEventHandler } from 'h3';
import { requireAdmin } from '../../../../utils/auth';
import { getAlbumMatchStatus } from '../../../../utils/albumMatchRunner';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return getAlbumMatchStatus();
});
