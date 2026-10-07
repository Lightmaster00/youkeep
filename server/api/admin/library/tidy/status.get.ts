import { defineEventHandler } from 'h3';
import { getTidyStatus } from '../../../../utils/videoTidy';

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  return getTidyStatus();
});
