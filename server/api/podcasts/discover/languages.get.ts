import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { listShowLanguages } from '../../../utils/podcastDiscover';

// Language chips of the Podcasts Discover page.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  return { languages: listShowLanguages(getDb(), session) };
});
