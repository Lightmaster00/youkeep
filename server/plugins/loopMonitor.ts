import { defineNitroPlugin } from 'nitropack/dist/runtime/plugin';
import { getLoopMonitor } from '../utils/loopMonitor';

// Measures event-loop stalls for Settings > System > Server responsiveness.
export default defineNitroPlugin(() => {
  try {
    getLoopMonitor().start();
  } catch (err) {
    console.error('YouKeep: could not start the event loop monitor:', err);
  }
});
