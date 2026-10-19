<template>
  <div class="account-container">
    <div class="account-header">
      <h1 class="page-title text-gradient">My Account</h1>
      <p class="page-subtitle">Manage your personal information and security settings.</p>
    </div>

    <!-- Mandatory Password Change Warning -->
    <div v-if="currentUser?.mustChangePassword" class="form-msg error-msg mt-3 mb-4 alert-box" role="alert">
      <strong>⚠️ Mandatory Security:</strong> You must change your temporary password before you can browse the app.
    </div>

    <div class="account-grid">
      <!-- Left Column: Personal Information -->
      <div class="account-col">
        <div class="profile-box glass-panel">
          <div class="profile-details-row">
            <div class="profile-avatar-large">
              {{ currentUser?.username?.charAt(0).toUpperCase() || 'U' }}
            </div>
            <div class="profile-meta-info">
              <h3>{{ currentUser?.username }}</h3>
              <span class="badge" :class="currentUser?.role === 'admin' ? 'badge-completed' : 'badge-pending'">
                Account Type: {{ currentUser?.role === 'admin' ? 'Administrator' : 'User' }}
              </span>
            </div>
          </div>

          <hr class="separator" />

          <h4>Personal Information</h4>
          <p class="section-desc">These details will be used to secure your account in the future.</p>
          
          <p v-if="currentUser?.mustChangePassword" class="section-desc" data-testid="profile-locked">
            You can edit these details once your new password is set.
          </p>
          <form v-else @submit.prevent="handleSavePersonalInfo" class="mt-4" data-testid="profile-form">
            <div class="form-row">
              <div class="form-group half-width">
                <label class="form-label" for="first_name">First Name</label>
                <input type="text" id="first_name" v-model="profile.firstName" class="form-input" placeholder="e.g. Jane" />
              </div>
              <div class="form-group half-width">
                <label class="form-label" for="last_name">Last Name</label>
                <input type="text" id="last_name" v-model="profile.lastName" class="form-input" placeholder="e.g. Doe" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="email">Email Address</label>
              <input type="email" id="email" v-model="profile.email" class="form-input" placeholder="name@example.com" />
            </div>

            <div class="form-row">
              <div class="form-group half-width">
                <label class="form-label" for="phone">Phone Number</label>
                <input type="tel" id="phone" v-model="profile.phone" class="form-input" placeholder="+1 234 567 890" />
              </div>
              <div class="form-group half-width">
                <label class="form-label" for="dob">Date of Birth</label>
                <input type="date" id="dob" v-model="profile.dob" class="form-input" />
              </div>
            </div>

            <div v-if="profileMessage" class="form-msg mt-3" :class="profileSuccess ? 'success-msg' : 'error-msg'" :role="profileSuccess ? 'status' : 'alert'" data-testid="profile-message">
              {{ profileMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" :loading="savingProfile">
                Save Information
              </UiButton>
            </div>
          </form>
        </div>

        <div v-if="!currentUser?.mustChangePassword" class="profile-box glass-panel">
          <div class="security-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="security-icon"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            <div>
              <h4>Display</h4>
              <p class="section-desc mb-0">Adjust grid density, navigation and the space shown at startup. Settings you leave unchanged follow the instance defaults.</p>
            </div>
          </div>

          <hr class="separator" />

          <DisplayPrefsForm mode="user" />
        </div>
      </div>

      <!-- Right Column: Security -->
      <div class="account-col">
        <div class="profile-box glass-panel security-box">
          <div class="security-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="security-icon"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            <div>
              <h4>Security & Password</h4>
              <p class="section-desc mb-0">Update your password to keep your account safe.</p>
            </div>
          </div>

          <hr class="separator" />

          <form @submit.prevent="handleChangeOwnPassword" class="password-change-form mt-4" novalidate>
            <div class="form-group">
              <label class="form-label" for="current_password">{{ currentUser?.mustChangePassword ? 'Temporary password' : 'Current password' }}</label>
              <input
                type="password"
                id="current_password"
                v-model="currentPasswordInput"
                class="form-input"
                placeholder="••••••••"
                autocomplete="current-password"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="own_password">New password</label>
              <input 
                type="password" 
                id="own_password" 
                v-model="ownPasswordInput"
                class="form-input"
                placeholder="••••••••"
                autocomplete="new-password"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="own_password_confirm">Confirm new password</label>
              <input 
                type="password" 
                id="own_password_confirm" 
                v-model="ownPasswordConfirmInput"
                class="form-input"
                placeholder="••••••••"
                autocomplete="new-password"
              />
            </div>

            <div v-if="ownPasswordMessage" class="form-msg mt-3" :class="ownPasswordSuccess ? 'success-msg' : 'error-msg'" :role="ownPasswordSuccess ? 'status' : 'alert'" data-testid="password-message">
              {{ ownPasswordMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" class="btn-block" :loading="savingOwnPassword">
                Update Password
              </UiButton>
            </div>
          </form>
        </div>

        <div v-if="!currentUser?.mustChangePassword" class="profile-box glass-panel api-tokens-box">
          <div class="security-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="security-icon"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
            <div>
              <h4>API tokens</h4>
              <p class="section-desc mb-0">Generate a token to connect an external app (mobile client, script) to your account.</p>
            </div>
          </div>

          <hr class="separator" />

          <div v-if="newToken" class="form-msg success-msg mt-3 mb-4 alert-box new-token-reveal">
            <strong>⚠️ This token will never be shown again.</strong> Copy it now:
            <div class="new-token-value">
              <code ref="tokenCodeEl">{{ newToken }}</code>
              <UiButton variant="secondary" @click="copyNewToken">Copy</UiButton>
            </div>
            <p v-if="copyMessage" class="copy-message" role="status">{{ copyMessage }}</p>
            <UiButton variant="primary" class="mt-3" @click="dismissNewToken">I've copied my token</UiButton>
          </div>

          <form v-else @submit.prevent="handleCreateToken" class="mt-4 token-create-form">
            <div class="form-group">
              <label class="form-label" for="token_label">Token name</label>
              <input
                type="text"
                id="token_label"
                v-model="newTokenLabel"
                class="form-input"
                placeholder="e.g. iPhone, living-room tablet"
                maxlength="100"
                required
              />
            </div>

            <div class="token-options">
              <div class="form-group">
                <label class="form-label" for="token_scope">Access</label>
                <select id="token_scope" v-model="newTokenScope" class="form-input">
                  <option value="read">Read-only</option>
                  <option value="full">Full access</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="token_expiry">Expires after</label>
                <select id="token_expiry" v-model="newTokenExpiry" class="form-input">
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>
            <p class="section-desc token-scope-hint">A read-only token can only read (GET requests); full access can also change things on your behalf.</p>

            <div v-if="tokenMessage" class="form-msg mt-3" :class="tokenSuccess ? 'success-msg' : 'error-msg'" :role="tokenSuccess ? 'status' : 'alert'">
              {{ tokenMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" :loading="creatingToken">
                Generate
              </UiButton>
            </div>
          </form>

          <div v-if="apiTokens.length > 0" class="api-tokens-list mt-4">
            <div v-for="token in apiTokens" :key="token.id" class="api-token-row">
              <div class="api-token-info">
                <span class="api-token-label">
                  {{ token.label }}
                  <span class="api-token-scope" :class="token.scope === 'read' ? 'scope-read' : 'scope-full'">{{ token.scope === 'read' ? 'Read-only' : 'Full access' }}</span>
                </span>
                <span class="api-token-meta">
                  Created {{ formatTokenDate(token.createdAt) }} ·
                  <span :class="{ 'token-expired': isTokenExpired(token) }">{{ tokenExpiryText(token) }}</span> ·
                  {{ token.lastUsedAt ? `Last used ${formatTokenDate(token.lastUsedAt)}` : 'Never used' }}
                </span>
              </div>
              <UiButton variant="danger" :loading="revokingTokenId === token.id" @click="handleRevokeToken(token.id)">
                Revoke
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { copyToClipboard } from '~/utils/clipboard';
import { confirmAction } from '~/composables/useConfirm';
import { ref, reactive, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { passwordProblem } from '~/utils/passwordRules';

useHead({ title: 'Account' });

const { user: currentUser, fetchUser } = useAuth();

// --- Profile Info Logic ---
const profile = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dob: ''
});
const savingProfile = ref(false);
const profileMessage = ref('');
const profileSuccess = ref(true);

const fetchProfile = async () => {
  try {
    const data = await $fetch('/api/account/profile');
    profile.firstName = data.firstName;
    profile.lastName = data.lastName;
    profile.email = data.email;
    profile.phone = data.phone;
    profile.dob = data.dob;
  } catch (err: any) {
    console.error('Failed to load profile data', err);
  }
};

onMounted(() => {
  fetchProfile();
});

const handleSavePersonalInfo = async () => {
  savingProfile.value = true;
  profileMessage.value = '';
  profileSuccess.value = true;
  try {
    await $fetch('/api/account/profile', {
      method: 'PUT',
      body: profile
    });
    profileSuccess.value = true;
    profileMessage.value = 'Personal information saved successfully!';
  } catch (err: any) {
    profileSuccess.value = false;
    profileMessage.value = err.data?.statusMessage || 'Saving profile failed.';
  } finally {
    savingProfile.value = false;
  }
};

// --- Password Change Logic ---
const currentPasswordInput = ref('');
const ownPasswordInput = ref('');
const ownPasswordConfirmInput = ref('');
const savingOwnPassword = ref(false);
const ownPasswordMessage = ref('');
const ownPasswordSuccess = ref(false);

const failPassword = (message: string) => {
  ownPasswordSuccess.value = false;
  ownPasswordMessage.value = message;
};

const handleChangeOwnPassword = async () => {
  if (!currentPasswordInput.value) {
    return failPassword(currentUser.value?.mustChangePassword
      ? 'Enter the temporary password you were given.'
      : 'Enter your current password.');
  }
  const problem = passwordProblem(ownPasswordInput.value);
  if (problem) return failPassword(problem);
  if (ownPasswordInput.value !== ownPasswordConfirmInput.value) {
    return failPassword('Passwords do not match.');
  }

  savingOwnPassword.value = true;
  ownPasswordMessage.value = '';

  try {
    // The response also rotates the session and CSRF cookies.
    await $fetch('/api/account/password', {
      method: 'PUT',
      body: {
        currentPassword: currentPasswordInput.value,
        password: ownPasswordInput.value
      }
    });

    ownPasswordSuccess.value = true;
    ownPasswordMessage.value = 'Your password has been changed successfully.';
    currentPasswordInput.value = '';
    ownPasswordInput.value = '';
    ownPasswordConfirmInput.value = '';

    // Refresh user details to update mustChangePassword state on client
    const wasForced = !!currentUser.value?.mustChangePassword;
    await fetchUser();
    if (wasForced && !currentUser.value?.mustChangePassword) {
      fetchProfile();
      fetchApiTokens();
    }
  } catch (err: any) {
    failPassword(err.data?.statusMessage || 'Changing the password failed.');
  } finally {
    savingOwnPassword.value = false;
  }
};

// --- API Tokens Logic ---
interface ApiToken {
  id: string;
  label: string;
  scope: 'read' | 'full';
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

const apiTokens = ref<ApiToken[]>([]);
const newTokenLabel = ref('');
const newTokenScope = ref<'read' | 'full'>('read');
const newTokenExpiry = ref<'30' | '90' | '365' | 'never'>('90');
const newToken = ref('');
const creatingToken = ref(false);
const tokenMessage = ref('');
const tokenSuccess = ref(true);
const revokingTokenId = ref('');

const fetchApiTokens = async () => {
  try {
    const data = await $fetch<{ tokens: ApiToken[] }>('/api/account/tokens');
    apiTokens.value = data.tokens;
  } catch (err: any) {
    console.error('Failed to load API tokens', err);
  }
};

const handleCreateToken = async () => {
  creatingToken.value = true;
  tokenMessage.value = '';
  tokenSuccess.value = true;
  try {
    const result = await $fetch<{ id: string; label: string; token: string }>('/api/account/tokens', {
      method: 'POST',
      body: {
        name: newTokenLabel.value,
        scope: newTokenScope.value,
        expiresInDays: newTokenExpiry.value === 'never' ? null : Number(newTokenExpiry.value)
      }
    });
    newToken.value = result.token;
    newTokenLabel.value = '';
    newTokenScope.value = 'read';
    newTokenExpiry.value = '90';
    await fetchApiTokens();
  } catch (err: any) {
    tokenSuccess.value = false;
    tokenMessage.value = err.data?.statusMessage || 'Failed to create the token.';
  } finally {
    creatingToken.value = false;
  }
};

const tokenCodeEl = ref<HTMLElement | null>(null);
const copyMessage = ref('');

// Plain http://<lan-ip> has no navigator.clipboard: copyToClipboard falls
// back to execCommand('copy'), then to a dialog with the token selected.
const copyNewToken = async () => {
  if (!newToken.value) return;
  copyMessage.value = '';
  const result = await copyToClipboard(newToken.value, 'Copy your API token');
  copyMessage.value = result === 'copied' ? 'Token copied.' : '';
};

const dismissNewToken = () => {
  newToken.value = '';
  copyMessage.value = '';
};

const handleRevokeToken = async (tokenId: string) => {
  if (!(await confirmAction({ title: 'Revoke token?', message: 'Revoke this token? Any app using it will immediately lose access.', confirmLabel: 'Revoke' }))) {
    return;
  }
  revokingTokenId.value = tokenId;
  try {
    await $fetch(`/api/account/tokens/${tokenId}`, { method: 'DELETE' });
    await fetchApiTokens();
  } catch (err: any) {
    console.error('Failed to revoke API token', err);
  } finally {
    revokingTokenId.value = '';
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;
const isTokenExpired = (token: ApiToken): boolean => token.expiresAt !== null && token.expiresAt <= Date.now();
const tokenExpiryText = (token: ApiToken): string => {
  if (token.expiresAt === null) return 'Never expires';
  if (isTokenExpired(token)) return 'Expired';
  const days = Math.ceil((token.expiresAt - Date.now()) / DAY_MS);
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`;
};

const formatTokenDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

onMounted(() => {
  // Tokens are refused (403) until a temporary password is replaced.
  if (!currentUser.value?.mustChangePassword) fetchApiTokens();
});
</script>

<style scoped>
.account-container {
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.account-header {
  margin-bottom: 30px;
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 15px;
}

/* Feedback under the forms: errors and successes look different, keep their
   distance from the buttons above, and wrap long server messages. */
.form-msg {
  display: block;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.error-msg {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.success-msg {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #6ee7b7;
}

.mt-3 {
  margin-top: 16px;
}

.mt-4 {
  margin-top: 20px;
}

.mb-4 {
  margin-bottom: 20px;
}

.alert-box {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border-radius: 12px;
}

.account-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

@media (min-width: 768px) {
  .account-grid {
    grid-template-columns: 3fr 2fr;
  }
}

.account-col {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}

.account-grid > * {
  min-width: 0;
}

.profile-box {
  padding: 30px;
  border-radius: 16px;
  min-width: 0;
}

@media (max-width: 480px) {
  .profile-box {
    padding: 20px 16px;
  }
  .api-token-row {
    flex-wrap: wrap;
  }
}

.security-box {
  background: linear-gradient(180deg, rgba(22, 22, 30, 0.7) 0%, rgba(30, 30, 40, 0.7) 100%);
}

.profile-details-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.profile-avatar-large {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 700;
  color: white;
  box-shadow: 0 8px 24px rgba(139, 92, 246, 0.3);
}

.profile-meta-info h3 {
  font-size: 24px;
  margin: 0 0 8px 0;
  font-weight: 700;
}

.security-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.security-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
  padding: 10px;
  background: rgba(139, 92, 246, 0.1);
  border-radius: 12px;
  width: 44px;
  height: 44px;
}

.security-header h4 {
  margin: 0 0 4px 0;
  font-size: 18px;
}

.separator {
  border: 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 24px 0;
}

h4 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}

.section-desc {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 20px;
}

.mb-0 {
  margin-bottom: 0 !important;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 36px;
  margin-bottom: 36px;
}

.half-width {
  flex: 1;
  min-width: min(220px, 100%);
}

.form-row .form-group {
  margin-bottom: 0;
}

.api-tokens-box {
  margin-top: 0;
}

.new-token-reveal {
  display: block;
}

.new-token-value {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 8px;
  font-family: monospace;
  word-break: break-all;
}

.new-token-value code {
  flex: 1;
  user-select: all;
}

.copy-message {
  margin-top: 8px;
  font-size: 13px;
}

.api-tokens-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.api-token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}

.api-token-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.api-token-label {
  font-weight: 600;
}

.api-token-meta {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.token-options {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.token-options .form-group {
  flex: 1;
  min-width: min(180px, 100%);
}

.token-scope-hint {
  font-size: 12.5px;
}

.api-token-scope {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  vertical-align: middle;
  border: 1px solid currentColor;
}

.api-token-scope.scope-read {
  color: var(--text-secondary);
}

.api-token-scope.scope-full {
  color: var(--accent-primary-hover);
}

.token-expired {
  color: #f87171;
  font-weight: 600;
}

</style>
