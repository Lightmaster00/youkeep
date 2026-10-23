import { defineEventHandler } from 'h3';
import { requireAdmin } from '../../utils/auth';
import { readSyncStatus } from '../../utils/autoSync';

// The automatic sync of each library: on/off, schedule, last completed and
// last started run, next run, and whether it looks stuck (Settings page).
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return readSyncStatus(getDb());
});
