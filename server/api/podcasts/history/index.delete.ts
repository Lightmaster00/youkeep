import { defineEventHandler } from 'h3';
import { requireUser } from '../../../utils/auth';
import { clearPodcastHistory } from '../../../utils/podcastProgress';

// Clear the caller's whole podcast history (every resume position too).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event);
  return { removed: clearPodcastHistory(getDb(), user.id) };
});
