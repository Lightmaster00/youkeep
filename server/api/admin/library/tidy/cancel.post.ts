import { defineEventHandler } from 'h3';
import { cancelTidyRun } from '../../../../utils/videoTidy';

// Stops the run after the video currently being moved.
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return { cancelling: cancelTidyRun() };
});
