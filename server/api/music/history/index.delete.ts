import { defineEventHandler } from 'h3';
import { requireUser } from '../../../utils/auth';
import { clearMusicHistory } from '../../../utils/musicHistory';

// Clear the caller's whole music listening history.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  return { removed: clearMusicHistory(getDb(), user.id) };
});
