import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { startSessionCleanup } from '../utils/auth';

// Expired sessions are otherwise only removed when their cookie comes back.
export default defineNitroPlugin((nitroApp) => {
  const stop = startSessionCleanup();
  nitroApp.hooks.hook('close', stop);
});
