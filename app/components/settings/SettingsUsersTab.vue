<template>
  <div class="tab-pane">
    <div class="users-dashboard-layout">
      <!-- Left Side: User profile config (40% width) -->
      <div class="user-config-col">
        <div class="user-form-panel glass-panel">
          <div class="section-title-row">
            <div class="icon-orb bg-purple">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline></svg>
            </div>
            <div>
              <h3>{{ editingUserId ? 'Edit user' : 'Add a user' }}</h3>
              <p class="section-desc">Create accounts, choose each person's role, and decide which ultra-private channels they can see.</p>
            </div>
          </div>

          <form @submit.prevent="handleSaveUser" class="user-form mt-4">
            <div class="form-group">
              <label class="form-label" for="u_username">Username</label>
              <input
                type="text"
                id="u_username"
                v-model="userForm.username"
                class="form-input"
                placeholder="e.g. Paul"
                required
                :disabled="!!editingUserId"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="u_password">
                {{ editingUserId ? 'New password (leave empty to keep the current one)' : 'Password (leave empty to generate one)' }}
              </label>
              <input
                type="password"
                id="u_password"
                v-model="userForm.password"
                class="form-input"
                placeholder="•••••••• (Optional)"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Role</label>
              <div class="role-selector-premium">
                <label class="role-card" :class="{ active: userForm.role === 'user' }">
                  <input type="radio" v-model="userForm.role" value="user" style="display: none;" />
                  <div class="role-card-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span>User</span>
                  </div>
                </label>
                <label class="role-card" :class="{ active: userForm.role === 'admin' }">
                  <input type="radio" v-model="userForm.role" value="admin" style="display: none;" />
                  <div class="role-card-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
                    <span>Admin</span>
                  </div>
                </label>
              </div>
            </div>

            <!-- Access checklist for user role -->
            <div v-if="userForm.role === 'user'" class="permissions-section-premium mt-3">
              <h4>Channel access</h4>

              <div class="form-group mt-2">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="fullChannelAccess" />
                  <span class="checkmark"></span>
                  Can see every channel
                </label>
              </div>

              <!-- Channels list (only if NOT full access) -->
              <div v-if="!fullChannelAccess" class="perm-col mt-2">
                <span class="perm-label">Ultra-private channels this user can see:</span>
                <div class="checklist-container-premium mt-2">
                  <label v-for="ch in channels" :key="ch.id" class="check-item-premium">
                    <input type="checkbox" v-model="userForm.channelAccess" :value="ch.id" />
                    <span class="checkmark-mini"></span>
                    <span>{{ ch.title }}</span>
                  </label>
                </div>
              </div>
            </div>

             <div v-if="generatedPassword" class="credentials-alert-box mt-3">
              <strong class="alert-title">Account saved.</strong>
              <div class="credentials-display mt-2">
                <div>Username: <code>{{ oldUsername || userForm.username }}</code></div>
                <div class="mt-1">Temporary password: <code class="pass-code">{{ generatedPassword }}</code></div>
              </div>

              <div class="mt-3">
                <button type="button" @click="copyCredentials" class="btn btn-secondary-dark btn-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                  Copy credentials
                </button>
              </div>
            </div>

            <div v-if="userFormMessage" class="settings-form-msg mt-3" :class="userFormSuccess ? 'settings-success-msg' : 'settings-error-msg'">
              {{ userFormMessage }}
            </div>

            <div class="form-actions mt-3">
              <button type="submit" class="btn btn-primary">
                {{ editingUserId ? 'Save changes' : 'Create user' }}
              </button>
              <button v-if="editingUserId" type="button" @click="cancelEditUser" class="btn btn-secondary-dark ml-2">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Right Side: Accounts List (60% width) -->
      <div class="users-list-col">
        <div class="users-list-panel glass-panel">
          <div class="col-header-row">
            <div class="flex-align-center gap-10">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: white;">Users</h3>
            </div>
          </div>

          <div v-if="usersPending" class="users-loading-state mt-4">
            <div class="spinner"></div>
          </div>
          <div v-else-if="users.length === 0" class="users-empty-state mt-4">
            No registered profiles. Add a profile using the config panel.
          </div>
          <div v-else class="users-list-grid mt-3">
            <div v-for="u in users" :key="u.id" class="user-card-premium">
              <div class="user-card-header">
                <div class="user-avatar-circle">
                  {{ u.username.slice(0, 2).toUpperCase() }}
                </div>
                <div class="user-headline-col">
                  <h4>{{ u.username }}</h4>
                  <UiBadge :tone="u.role === 'admin' ? 'completed' : 'neutral'">
                    {{ u.role === 'admin' ? 'Admin' : 'User' }}
                  </UiBadge>
                </div>
              </div>

              <div class="user-card-meta mt-2">
                <span class="user-date">Registered: {{ formatDate(u.created_at) }}</span>
                <span class="user-scope" v-if="u.role === 'user'">
                  {{ u.channelAccess?.length ? `Ultra-private access: ${u.channelAccess.length} channel(s)` : 'No ultra-private access' }}
                </span>
              </div>

              <div class="user-card-action-bar border-t mt-3 pt-2">
                <button
                  @click="handleResetPassword(u.id, u.username)"
                  class="btn-action-premium-icon"
                  title="Reset password"
                  :disabled="u.id === currentUser?.id"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  <span>Reset password</span>
                </button>
                <button @click="loadUserForEdit(u)" class="btn-action-premium-icon" title="Edit Profile">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  <span>Edit</span>
                </button>
                <button
                  @click="handleDeleteUser(u.id, u.username)"
                  class="btn-action-premium-icon danger-icon"
                  title="Delete Profile"
                  :disabled="u.id === currentUser?.id || u.username === 'admin'"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useAdminChannels } from '~/composables/useAdminChannels';
import { useToast } from '~/composables/useToast';

const toast = useToast();
const { user: currentUser } = useAuth();
const { channels } = await useAdminChannels();

const { data: usersData, pending: usersPending, refresh: refreshUsers } = await useFetch<{ users: any[] }>('/api/admin/users');
const users = computed(() => usersData.value?.users || []);

const generatedPassword = ref('');
const editingUserId = ref<string | null>(null);
const fullChannelAccess = ref(true);

const userForm = reactive({
  username: '',
  password: '',
  role: 'user' as 'user' | 'admin',
  channelAccess: [] as string[]
});
const userFormMessage = ref('');
const userFormSuccess = ref(false);
const oldUsername = ref('');

const copyCredentials = () => {
  const text = `YouKeep Credentials:\nUsername: ${oldUsername.value || userForm.username}\nTemporary password: ${generatedPassword.value}`;
  navigator.clipboard.writeText(text).then(() => {
    toast.success('Sign-in details copied.');
  }).catch(() => {
    toast.error('Copy failed.');
  });
};

const loadUserForEdit = (user: any) => {
  generatedPassword.value = '';
  oldUsername.value = '';
  editingUserId.value = user.id;
  userForm.username = user.username;
  userForm.password = '';
  userForm.role = user.role;
  userForm.channelAccess = [...(user.channelAccess || [])];

  // Set toggle if user channel access matches all available channels
  const allIds = channels.value.map((c: any) => c.id);
  fullChannelAccess.value = allIds.length > 0 && allIds.every((id: string) => userForm.channelAccess.includes(id));

  userFormMessage.value = '';
};

const cancelEditUser = () => {
  editingUserId.value = null;
  userForm.username = '';
  userForm.password = '';
  userForm.role = 'user';
  userForm.channelAccess = [];
  fullChannelAccess.value = true;
  userFormMessage.value = '';
};

const handleSaveUser = async () => {
  userFormMessage.value = '';
  const submitChannelAccess = fullChannelAccess.value && userForm.role === 'user'
    ? channels.value.map((c: any) => c.id)
    : userForm.channelAccess;

  try {
    if (editingUserId.value) {
      await $fetch(`/api/admin/users/${editingUserId.value}`, {
        method: 'PUT',
        body: {
          password: userForm.password || undefined,
          role: userForm.role,
          channelAccess: submitChannelAccess
        }
      });
      userFormSuccess.value = true;
      userFormMessage.value = 'User updated successfully.';
    } else {
      const res = await $fetch<any>('/api/admin/users', {
        method: 'POST',
        body: {
          username: userForm.username,
          password: userForm.password,
          role: userForm.role,
          channelAccess: submitChannelAccess
        }
      });
      userFormSuccess.value = true;
      userFormMessage.value = 'User created successfully.';
      if (res && res.password) {
        generatedPassword.value = res.password;
      }
    }
    oldUsername.value = userForm.username;
    cancelEditUser();
    refreshUsers();
  } catch (err: any) {
    userFormSuccess.value = false;
    userFormMessage.value = err.data?.statusMessage || 'An error occurred.';
  }
};

const handleDeleteUser = async (id: string, name: string) => {
  if (!confirm(`Permanently delete the user "${name}"?`)) return;
  try {
    await $fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    refreshUsers();
    toast.success('User deleted.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Delete failed.');
  }
};

const handleResetPassword = async (userId: string, username: string) => {
  if (!confirm(`Do you want to reset the password for "${username}"? A new temporary password will be generated.`)) return;
  try {
    const res = await $fetch<any>(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST'
    });
    if (res && res.password) {
      generatedPassword.value = res.password;
      oldUsername.value = res.username;
      toast.success('Password reset.');
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Reset failed.');
  }
};

const formatDate = (ts: number) => {
  return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};
</script>
