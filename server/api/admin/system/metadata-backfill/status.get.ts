import { defineEventHandler } from 'h3';
import { requireSessionAdmin } from '../../../../utils/auth';
import { getMetadataBackfillCounts, getMetadataBackfillStatus } from '../../../../utils/metadataBackfill';

// Counts (total / enriched / pending), the setting and the current run, for the "Video categories" tool.
export default defineEventHandler(async (event) => {
  await requireSessionAdmin(event);
  return { ...getMetadataBackfillCounts(getDb()), run: getMetadataBackfillStatus() };
});
