import { computed } from 'vue';
import type { LanguageCode } from '#shared/languages';
import { clearClientCaches } from '~/utils/clientCaches';
import { clearUserClientState, readClientOwner, writeClientOwner } from '~/utils/userClientState';

export interface UserSession {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword?: boolean;
  uiLanguage?: LanguageCode | null;
}

export const useAuth = () => {
  // Captured now: logout/login run from event handlers, after awaits.
  const nuxtApp = useNuxtApp();
  const user = useState<UserSession | null>('auth_user', () => null);
  const loading = useState<boolean>('auth_loading', () => true);

  const isLoggedIn = computed(() => !!user.value);
  const isAdmin = computed(() => user.value?.role === 'admin');

  const fetchUser = async () => {
    loading.value = true;
    try {
      const { data } = await useFetch<{ user: UserSession | null }>('/api/auth/me');
      user.value = data.value?.user || null;
    } catch (err) {
      user.value = null;
    } finally {
      loading.value = false;
    }
  };

  // remember: keep the session for its full 7 days even when unused (else it
  // ends after 24 h of inactivity).
  const login = async (username: string, password: string, remember = false) => {
    try {
      const response = await $fetch<{ success: boolean; user: UserSession }>('/api/auth/login', {
        method: 'POST',
        body: { username, password, remember }
      });

      if (response.success) {
        // Another user's leftovers (their session ended without a logout
        // here): drop them before this user's pages render.
        const owner = import.meta.client ? readClientOwner() : null;
        if (owner && owner !== response.user.id) nuxtApp.runWithContext(() => clearUserClientState());
        if (import.meta.client) writeClientOwner(response.user.id);
        user.value = response.user;
        return { success: true };
      }
      return { success: false, message: 'Authentication failed' };
    } catch (err: any) {
      return { 
        success: false, 
        message: err.data?.statusMessage || 'Invalid username or password.' 
      };
    }
  };

  const logout = async () => {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      user.value = null;
      // Nothing of this user stays in the browser for the next one.
      nuxtApp.runWithContext(() => clearUserClientState());
      // The service worker cache must not outlive the session (shared browsers).
      await clearClientCaches();
      navigateTo('/login');
    }
  };

  return {
    user,
    loading,
    isLoggedIn,
    isAdmin,
    fetchUser,
    login,
    logout
  };
};
