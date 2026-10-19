<template>
  <div class="security-log-panel" data-testid="security-log-panel">
    <div class="security-log-head">
      <p class="section-desc security-log-intro">Failed sign-ins, sign-ins from a new address, password, token and account changes, and library wipe or tidy runs. Kept 90 days.</p>
      <button type="button" class="btn btn-secondary-dark btn-icon-sm" :disabled="loading" data-testid="security-log-refresh" @click="load">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </div>
    <p v-if="errorMessage" class="settings-error-msg" data-testid="security-log-error">{{ errorMessage }}</p>
    <p v-else-if="loaded && events.length === 0" class="section-desc" data-testid="security-log-empty">No security events recorded yet.</p>
    <div v-else-if="events.length > 0" class="security-log-scroll">
      <table class="security-log-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Event</th>
            <th scope="col">User</th>
            <th scope="col">Address</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id" data-testid="security-log-row" :class="{ 'is-failure': e.type === 'login_failed' }">
            <td class="nowrap">{{ formatTime(e.createdAt) }}</td>
            <td class="nowrap">{{ typeLabel(e.type) }}</td>
            <td>{{ e.username || '—' }}</td>
            <td class="nowrap mono">{{ e.ip || '—' }}</td>
            <td>{{ describe(e) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

// Compact view of GET /api/admin/security-events (server/utils/securityLog.ts).
interface SecurityEvent {
  id: number;
  createdAt: number;
  type: string;
  ip: string | null;
  userId: string | null;
  username: string | null;
  details: Record<string, unknown>;
}

const LIMIT = 100;
const events = ref<SecurityEvent[]>([]);
const loading = ref(false);
const loaded = ref(false);
const errorMessage = ref('');

const TYPE_LABELS: Record<string, string> = {
  login_failed: 'Failed login',
  login_new_ip: 'Login from a new address',
  password_changed: 'Password changed',
  password_reset: 'Password reset',
  token_created: 'API token created',
  token_revoked: 'API token revoked',
  user_created: 'User created',
  user_deleted: 'User deleted',
  user_role_changed: 'Role changed',
  library_wipe_started: 'Library wipe started',
  library_tidy_started: 'Library tidy started',
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function describe(e: SecurityEvent): string {
  const d = e.details || {};
  const parts: string[] = [];
  if (typeof d.reason === 'string') parts.push(d.reason.replace(/_/g, ' '));
  if (typeof d.targetName === 'string') parts.push(`user ${d.targetName}`);
  else if (typeof d.targetId === 'string' && d.targetId !== e.userId) parts.push(`user id ${d.targetId}`);
  if (typeof d.from === 'string' && typeof d.to === 'string') parts.push(`${d.from} → ${d.to}`);
  if (typeof d.role === 'string') parts.push(d.role);
  if (typeof d.tokenLabel === 'string') parts.push(`"${d.tokenLabel}"`);
  if (d.scope === 'read' || d.scope === 'full') parts.push(d.scope === 'read' ? 'read-only' : 'full access');
  if (d.by === 'admin') parts.push('by an admin');
  return parts.join(', ') || '—';
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    const data = await $fetch<{ events: SecurityEvent[] }>('/api/admin/security-events', { query: { limit: LIMIT } });
    events.value = Array.isArray(data?.events) ? data.events : [];
    errorMessage.value = '';
    loaded.value = true;
  } catch {
    errorMessage.value = 'Could not read the security log.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.security-log-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
}

.security-log-intro {
  flex: 1 1 240px;
  margin: 0;
}

.security-log-scroll {
  margin-top: 12px;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
}

.security-log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.security-log-table th,
.security-log-table td {
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--glass-border);
}

.security-log-table th {
  position: sticky;
  top: 0;
  background: var(--bg-elevated-2);
  color: var(--text-secondary);
  font-weight: 600;
}

.security-log-table tr.is-failure td:nth-child(2) {
  color: #f87171;
}

.nowrap {
  white-space: nowrap;
}

.mono {
  font-family: monospace;
}
</style>
