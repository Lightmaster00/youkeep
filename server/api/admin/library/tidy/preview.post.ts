import { defineEventHandler } from 'h3';
import { planTidyAsync } from '../../../../utils/videoTidy';

// Read-only: computes what "Tidy library files" would move. Nothing on disk changes.
// The async planner yields between videos so a big network share cannot freeze the server.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const plan = await planTidyAsync(getDb(), { downloadsDir: getDownloadsDir() });
  return plan.preview;
});
