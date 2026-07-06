<template>
  <div class="login-container">
    <div class="login-card glass-panel">
      <div class="logo-container">
        <span class="logo-you">You</span><span class="logo-keep">Keep</span>
      </div>
      
      <h2 class="login-title">
        {{ setupRequired ? 'YouKeep Setup' : 'Login to your archive' }}
      </h2>
      <p class="login-subtitle">
        {{ setupRequired ? 'Create your main administrator profile to start.' : 'Enter your credentials to access the archived videos.' }}
      </p>

      <form @submit.prevent="handleSubmit" class="login-form">
        <div class="form-group">
          <label class="form-label" for="username">Username</label>
          <input 
            type="text" 
            id="username" 
            v-model="username" 
            class="form-input" 
            placeholder="admin" 
            required 
            :disabled="loadingSubmit"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="password">Password</label>
          <input 
            type="password" 
            id="password" 
            v-model="password" 
            class="form-input" 
            placeholder="••••••••" 
            required 
            :disabled="loadingSubmit"
          />
        </div>

        <div v-if="setupRequired" class="form-group">
          <label class="form-label" for="confirmPassword">Confirm Password</label>
          <input 
            type="password" 
            id="confirmPassword" 
            v-model="confirmPassword" 
            class="form-input" 
            placeholder="••••••••" 
            required 
            :disabled="loadingSubmit"
          />
        </div>

        <div v-if="errorMessage" class="error-box">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>{{ errorMessage }}</span>
        </div>

        <button type="submit" class="btn btn-primary login-btn" :disabled="loadingSubmit">
          <span v-if="loadingSubmit" class="spinner"></span>
          <span v-else>{{ setupRequired ? 'Setup YouKeep' : 'Log in' }}</span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';

// Disable default layout for the login page
definePageMeta({
  layout: false
});

const { login } = useAuth();
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const errorMessage = ref('');
const loadingSubmit = ref(false);
const setupRequired = ref(false);

const checkSetupStatus = async () => {
  try {
    const res = await $fetch<{ setupRequired: boolean }>('/api/auth/setup-status');
    setupRequired.value = res.setupRequired;
  } catch (e) {}
};

onMounted(() => {
  checkSetupStatus();
});

const handleSubmit = async () => {
  if (setupRequired.value) {
    await handleSetup();
  } else {
    await handleLogin();
  }
};

const handleSetup = async () => {
  if (password.value !== confirmPassword.value) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }
  
  errorMessage.value = '';
  loadingSubmit.value = true;

  try {
    const res = await $fetch<{ success: boolean }>('/api/auth/setup', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value
      }
    });

    if (res.success) {
      const { fetchUser } = useAuth();
      await fetchUser();
      navigateTo('/');
    }
  } catch (err: any) {
    errorMessage.value = err.data?.statusMessage || 'Setup failed.';
  } finally {
    loadingSubmit.value = false;
  }
};

const handleLogin = async () => {
  errorMessage.value = '';
  loadingSubmit.value = true;

  const res = await login(username.value, password.value);
  loadingSubmit.value = false;

  if (res.success) {
    navigateTo('/');
  } else {
    errorMessage.value = res.message || 'Incorrect credentials.';
  }
};
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-base);
  background-image: radial-gradient(circle at center, rgba(139, 92, 246, 0.08) 0%, transparent 70%);
  padding: 16px;
}

.login-card {
  width: 420px;
  max-width: 100%;
  padding: 40px;
  border-radius: var(--border-radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}

.logo-container {
  display: flex;
  justify-content: center;
  align-items: center;
  font-family: var(--font-title);
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
  margin-bottom: 24px;
}

.logo-you {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 800;
}

.logo-keep {
  color: var(--text-primary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(4px);
  padding: 1px 9px;
  border-radius: 8px;
  margin-left: 4px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15);
}

.login-title {
  font-size: 20px;
  text-align: center;
  margin-bottom: 8px;
}

.login-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  margin-bottom: 32px;
  line-height: 1.5;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}



.error-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  font-size: 13px;
}

.login-btn {
  margin-top: 8px;
  height: 44px;
  border-radius: var(--border-radius-md);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
