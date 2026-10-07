import { defineEventHandler } from 'h3';
import { previewTidy } from '../../../../utils/videoTidy';

// Read-only: computes what "Tidy library files" would move. Nothing on disk changes.
// The async planner yields between videos so a big network share cannot freeze the server;
// concurrent requests share one computation.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return previewTidy(getDb(), { downloadsDir: getDownloadsDir() });
});
