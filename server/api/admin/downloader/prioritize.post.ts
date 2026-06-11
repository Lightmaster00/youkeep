import { defineEventHandler, readBody, createError } from 'h3';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = await readBody(event);
  const { videoId } = body;

  if (!videoId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Video ID is required.'
    });
  }

  const db = getDb();

  // Find the highest priority value currently in the videos table
  const maxPriorityResult = db.prepare('SELECT MAX(priority) as maxPriority FROM videos').get() as { maxPriority: number | null };
  const nextPriority = (maxPriorityResult?.maxPriority || 0) + 1;

  // Set the target video priority to nextPriority so it gets processed next and mark manually queued
  db.prepare('UPDATE videos SET priority = ?, is_manually_queued = 1 WHERE id = ?').run(nextPriority, videoId);

  // Trigger worker
  startQueueWorker();

  return { success: true, priority: nextPriority };
});
