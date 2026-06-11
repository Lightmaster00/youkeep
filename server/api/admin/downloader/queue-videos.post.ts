import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const db = getDb();
  const body = await readBody(event);
  const { videoIds } = body || {}; // videoIds in exact display order

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Une liste d\'identifiants de vidéos est requise.'
    });
  }

  // Find the highest priority value currently in the videos table
  const maxPriorityResult = db.prepare('SELECT MAX(priority) as maxPriority FROM videos').get() as { maxPriority: number | null };
  let currentMax = maxPriorityResult?.maxPriority || 0;

  const updateStmt = db.prepare(`
    UPDATE videos 
    SET download_status = 'pending', 
        download_progress = 0, 
        download_speed = NULL, 
        download_eta = NULL,
        is_manually_queued = 1,
        priority = ? 
    WHERE id = ? AND download_status != 'completed'
  `);
  
  const transaction = db.transaction((ids: string[]) => {
    // Loop backwards so the first element in the array gets the highest priority (processed first)
    for (let i = ids.length - 1; i >= 0; i--) {
      currentMax += 1;
      updateStmt.run(currentMax, ids[i]);
    }
  });
  
  transaction(videoIds);

  // Trigger queue processing in the background
  startQueueWorker();

  return { success: true };
});
