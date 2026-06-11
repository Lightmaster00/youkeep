import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
  const user = await getUserFromSession(event);
  return { user };
});
