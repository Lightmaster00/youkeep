import { defineEventHandler } from 'h3';
import { getModuleStates } from '../../utils/modules';

export default defineEventHandler(async () => {
  try {
    return getModuleStates(getDb());
  } catch {
    return { video: true, music: true, podcasts: true };
  }
});
