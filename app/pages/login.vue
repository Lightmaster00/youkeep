<template>
  <div class="login-container">
    <div class="login-card glass-panel">
      <div class="logo-container">
        <AppLogo size="lg" />
      </div>
      
      <h2 class="login-title">
        {{ setupRequired ? t('login.setupTitle') : t('login.title') }}
      </h2>
      <p class="login-subtitle">
        {{ setupRequired ? t('login.setupSubtitle') : t('login.subtitle') }}
      </p>

      <form @submit.prevent="handleSubmit" class="login-form">
        <div class="form-group">
          <label class="form-label" for="username">{{ t('login.username') }}</label>
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
          <label class="form-label" for="password">{{ t('login.password') }}</label>
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

        <div v-if="!setupRequired" class="remember-row">
          <input type="checkbox" id="remember_me" v-model="rememberMe" :disabled="loadingSubmit" />
          <label for="remember_me">{{ t('login.keepSignedIn') }}</label>
        </div>

        <div v-if="setupRequired" class="form-group">
          <label class="form-label" for="confirmPassword">{{ t('login.confirmPassword') }}</label>
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

        <UiButton variant="primary" type="submit" class="login-btn" :loading="loadingSubmit">
          {{ setupRequired ? t('login.setupSubmit') : t('login.submit') }}
        </UiButton>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { apiErrorMessage } from '~/utils/apiError';
import { ref, onMounted } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { safeRedirectPath } from '~/utils/safeRedirect';

const { t } = useI18n();

useHead({ title: t('login.submit') });

// Disable default layout for the login page
definePageMeta({
  layout: false
});

const { login } = useAuth();
const route = useRoute();
// The page the user wanted before being sent here (same-origin paths only).
const afterLogin = () => safeRedirectPath(route.query.redirect) || '/';
const username = ref('');
const password = ref('');
// On (the default, a personal self-hosted app): the session lasts its full
// 7 days. Unticked: it ends after 24 h unused.
const rememberMe = ref(true);
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
    errorMessage.value = t('login.passwordsMismatch');
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
      navigateTo(afterLogin());
    }
  } catch (err: any) {
    errorMessage.value = apiErrorMessage(err, t, 'login.setupFailed');
  } finally {
    loadingSubmit.value = false;
  }
};

const handleLogin = async () => {
  errorMessage.value = '';
  loadingSubmit.value = true;

  const res = await login(username.value, password.value, rememberMe.value);
  loadingSubmit.value = false;

  if (res.success) {
    navigateTo(afterLogin());
  } else {
    errorMessage.value = res.message || t('login.incorrect');
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
  margin-bottom: 24px;
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

.remember-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -4px 0 16px;
  font-size: 14px;
  color: var(--text-secondary);
}

.remember-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-primary);
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

</style>
