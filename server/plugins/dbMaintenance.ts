import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { getDb } from '../utils/db';
import { startPlannerMaintenance } from '../utils/dbTuning';

// PRAGMA optimize every 6 hours (openDatabase already ran it at startup).
export default defineNitroPlugin((nitroApp) => {
  const stop = startPlannerMaintenance(getDb);
  nitroApp.hooks.hook('close', stop);
});
