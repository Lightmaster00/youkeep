import { ref, computed } from 'vue';

export interface UserSession {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword?: boolean;
}

export const useAuth = () => {
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

  const login = async (username: string, password: string) => {
    try {
      const response = await $fetch<{ success: boolean; user: UserSession }>('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      });

      if (response.success) {
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
