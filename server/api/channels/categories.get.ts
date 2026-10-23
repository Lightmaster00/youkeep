import { defineEventHandler } from 'h3';
import { queryChannelCategories } from '../../utils/channelDirectory';

// The categories of the channels this viewer may see, with how many channels
// carry each (effective categories: an admin's override, else automatic).
export default defineEventHandler(async (event) => {
  const session = await getUserFromSession(event);
  return { categories: queryChannelCategories(getDb(), session) };
});
