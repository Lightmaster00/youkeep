import { defineEventHandler } from 'h3';
import { queryDirectoryDiscover } from '../../utils/channelDirectory';

// The Discover strip of the channels page: unfollowed channels close to what
// the viewer watches. Empty for guests.
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  if (!session) return { channels: [] };
  return { channels: queryDirectoryDiscover(getDb(), session) };
});
