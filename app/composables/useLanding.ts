import { resolveLandingTarget } from '../utils/displayPrefs';

const MARKER_KEY = 'landing_applied';

export const useLanding = () => {
  const auth = useAuth();
  const modules = useModules();
  const prefs = useDisplayPrefs();

  // The route to start on, at most once per browser tab session and per user,
  // or null. Client only; any sessionStorage failure means "no redirect".
  const consumeLandingTarget = async (): Promise<string | null> => {
    if (!import.meta.client) return null;
    const userKey = auth.user.value?.id ?? 'guest';
    try {
      if (window.sessionStorage.getItem(MARKER_KEY) === userKey) return null;
      window.sessionStorage.setItem(MARKER_KEY, userKey);
    } catch {
      return null;
    }
    await Promise.all([modules.ensureLoaded(), prefs.ensureLoaded()]);
    return resolveLandingTarget(prefs.effective.value.landingSpace, modules.enabledModules.value);
  };

  return { consumeLandingTarget };
};
