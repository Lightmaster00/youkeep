import { defineEventHandler } from 'h3';
import { getUserFromSession } from '../../../utils/auth';
import { listGenres } from '../../../utils/musicDiscover';

// Genre tiles of the Discover page, biggest first.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  return { genres: listGenres(getDb(), session) };
});
