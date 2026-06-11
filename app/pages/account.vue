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

            <div v-if="profileMessage" class="form-msg mt-3 success-msg">
              {{ profileMessage }}
            </div>

            <div class="form-actions mt-4">
              <button type="submit" class="btn btn-secondary" :disabled="savingProfile">
                {{ savingProfile ? 'Saving...' : 'Save Information' }}
              </button>
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
              <button type="submit" class="btn btn-primary btn-block" :disabled="savingOwnPassword">
                {{ savingOwnPassword ? 'Updating...' : 'Update Password' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useAuth } from '~/composables/useAuth';

const { user: currentUser } = useAuth();

// --- Profile Info Logic (Visual for now) ---
const profile = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dob: ''
});
const savingProfile = ref(false);
const profileMessage = ref('');

const handleSavePersonalInfo = () => {
  savingProfile.value = true;
  profileMessage.value = '';
  // Simulate network request
  setTimeout(() => {
    savingProfile.value = false;
    profileMessage.value = 'Personal information saved successfully! (Visual preview)';
  }, 800);
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
</script>

<style scoped>
.account-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 40px 20px;
}

.account-header {
  margin-bottom: 30px;
}

.page-title {
  font-size: 32px;
  font-weight: 800;
  margin-bottom: 8px;
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
  gap: 32px;
  margin-bottom: 32px;
}

.half-width {
  flex: 1;
  min-width: 200px;
}

.form-group {
  margin-bottom: 28px;
}

.form-row .form-group {
  margin-bottom: 0;
}

.btn-block {
  width: 100%;
  justify-content: center;
  padding: 14px;
  margin-top: 16px;
}
</style>
