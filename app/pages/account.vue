<template>
  <div class="account-container">
    <div class="account-header">
      <h1 class="page-title text-gradient">My Account</h1>
      <p class="page-subtitle">Manage your personal information and security settings.</p>
    </div>

    <!-- Mandatory Password Change Warning -->
    <div v-if="currentUser?.mustChangePassword" class="form-msg error-msg mt-3 mb-4 alert-box">
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
          
          <form @submit.prevent="handleSavePersonalInfo" class="mt-4">
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

            <div v-if="profileMessage" class="form-msg mt-3" :class="profileSuccess ? 'success-msg' : 'error-msg'">
              {{ profileMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" :loading="savingProfile">
                Save Information
              </UiButton>
            </div>
          </form>
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

          <form @submit.prevent="handleChangeOwnPassword" class="password-change-form mt-4">
            <div class="form-group">
              <label class="form-label" for="own_password">New password</label>
              <input 
                type="password" 
                id="own_password" 
                v-model="ownPasswordInput" 
                class="form-input" 
                placeholder="••••••••" 
                required
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
                required
              />
            </div>

            <div v-if="ownPasswordMessage" class="form-msg mt-3" :class="ownPasswordSuccess ? 'success-msg' : 'error-msg'">
              {{ ownPasswordMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" class="btn-block" :loading="savingOwnPassword">
                Update Password
              </UiButton>
            </div>
          </form>
        </div>

        <div class="profile-box glass-panel api-tokens-box">
          <div class="security-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="security-icon"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
            <div>
              <h4>Jetons API</h4>
              <p class="section-desc mb-0">Générez un jeton pour connecter une application externe (client mobile, script) à votre compte.</p>
            </div>
          </div>

          <hr class="separator" />

          <div v-if="newToken" class="form-msg success-msg mt-3 mb-4 alert-box new-token-reveal">
            <strong>⚠️ Ce jeton ne sera plus jamais affiché.</strong> Copiez-le maintenant :
            <div class="new-token-value">
              <code ref="tokenCodeEl">{{ newToken }}</code>
              <UiButton variant="secondary" @click="copyNewToken">Copier</UiButton>
            </div>
            <p v-if="copyMessage" class="copy-message">{{ copyMessage }}</p>
            <UiButton variant="primary" class="mt-3" @click="dismissNewToken">J'ai copié mon jeton</UiButton>
          </div>

          <form v-else @submit.prevent="handleCreateToken" class="mt-4">
            <div class="form-group">
              <label class="form-label" for="token_label">Nom du jeton</label>
              <input
                type="text"
                id="token_label"
                v-model="newTokenLabel"
                class="form-input"
                placeholder="ex : iPhone, Tablette salon"
                maxlength="100"
                required
              />
            </div>

            <div v-if="tokenMessage" class="form-msg mt-3" :class="tokenSuccess ? 'success-msg' : 'error-msg'">
              {{ tokenMessage }}
            </div>

            <div class="form-actions mt-4">
              <UiButton variant="primary" type="submit" :loading="creatingToken">
                Générer
              </UiButton>
            </div>
          </form>

          <div v-if="apiTokens.length > 0" class="api-tokens-list mt-4">
            <div v-for="token in apiTokens" :key="token.id" class="api-token-row">
              <div class="api-token-info">
                <span class="api-token-label">{{ token.label }}</span>
                <span class="api-token-meta">
                  Créé le {{ formatTokenDate(token.createdAt) }} ·
                  {{ token.lastUsedAt ? `Utilisé le ${formatTokenDate(token.lastUsedAt)}` : 'Jamais utilisé' }}
                </span>
              </div>
              <UiButton variant="danger" :loading="revokingTokenId === token.id" @click="handleRevokeToken(token.id)">
                Révoquer
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';

const { user: currentUser } = useAuth();

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
const ownPasswordInput = ref('');
const ownPasswordConfirmInput = ref('');
const savingOwnPassword = ref(false);
const ownPasswordMessage = ref('');
const ownPasswordSuccess = ref(false);

const handleChangeOwnPassword = async () => {
  if (ownPasswordInput.value !== ownPasswordConfirmInput.value) {
    ownPasswordSuccess.value = false;
    ownPasswordMessage.value = 'Passwords do not match.';
    return;
  }
  
  if (ownPasswordInput.value.length < 6) {
    ownPasswordSuccess.value = false;
    ownPasswordMessage.value = 'Password must be at least 6 characters.';
    return;
  }
  
  savingOwnPassword.value = true;
  ownPasswordMessage.value = '';
  
  try {
    await $fetch('/api/account/password', {
      method: 'PUT',
      body: {
        password: ownPasswordInput.value
      }
    });
    
    ownPasswordSuccess.value = true;
    ownPasswordMessage.value = 'Your password has been changed successfully.';
    ownPasswordInput.value = '';
    ownPasswordConfirmInput.value = '';
    
    // Refresh user details to update mustChangePassword state on client
    const auth = useAuth();
    await auth.fetchUser();
  } catch (err: any) {
    ownPasswordSuccess.value = false;
    ownPasswordMessage.value = err.data?.statusMessage || 'Modification failed.';
  } finally {
    savingOwnPassword.value = false;
  }
};

// --- API Tokens Logic ---
interface ApiToken {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const apiTokens = ref<ApiToken[]>([]);
const newTokenLabel = ref('');
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
      body: { label: newTokenLabel.value }
    });
    newToken.value = result.token;
    newTokenLabel.value = '';
    await fetchApiTokens();
  } catch (err: any) {
    tokenSuccess.value = false;
    tokenMessage.value = err.data?.statusMessage || 'La création du jeton a échoué.';
  } finally {
    creatingToken.value = false;
  }
};

const tokenCodeEl = ref<HTMLElement | null>(null);
const copyMessage = ref('');

// navigator.clipboard only exists on HTTPS / localhost; a self-hosted instance
// reached over plain http://<lan-ip> has none, so fall back to selecting the
// text and execCommand('copy'), and finally to a manual-copy hint.
const copyNewToken = async () => {
  if (!newToken.value) return;
  copyMessage.value = '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(newToken.value);
      copyMessage.value = 'Jeton copié.';
      return;
    }
  } catch (e) {
    // fall through to the selection fallback
  }
  const el = tokenCodeEl.value;
  if (el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      if (document.execCommand('copy')) {
        copyMessage.value = 'Jeton copié.';
        return;
      }
    } catch (e) {
      // leave the text selected for a manual copy
    }
  }
  copyMessage.value = 'Copie automatique impossible : le jeton est sélectionné, copiez-le avec Ctrl+C (ou Cmd+C).';
};

const dismissNewToken = () => {
  newToken.value = '';
  copyMessage.value = '';
};

const handleRevokeToken = async (tokenId: string) => {
  if (!confirm('Révoquer ce jeton ? Toute application qui l\'utilise perdra immédiatement l\'accès.')) {
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

const formatTokenDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
};

onMounted(() => {
  fetchApiTokens();
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
}

.profile-box {
  padding: 30px;
  border-radius: 16px;
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
  min-width: 220px;
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

</style>
