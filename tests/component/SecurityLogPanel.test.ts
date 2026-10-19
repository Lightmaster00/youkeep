import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SecurityLogPanel from '../../app/components/settings/SecurityLogPanel.vue';

let reply: () => any;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reply = () => ({ events: [] });
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/admin/security-events')) return reply();
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountPanel = async () => {
  const w = await mountSuspended(SecurityLogPanel);
  await flushPromises();
  return w;
};

describe('SecurityLogPanel', () => {
  it('loads the latest events and shows one row each, newest first', async () => {
    const t = new Date('2026-10-19T10:00:00Z').getTime();
    reply = () => ({ events: [
      { id: 2, createdAt: t, type: 'login_failed', ip: '192.0.2.10', userId: null, username: 'ghost', details: { reason: 'unknown_user' } },
      { id: 1, createdAt: t - 1000, type: 'user_role_changed', ip: '192.0.2.11', userId: 'a1', username: 'root', details: { targetId: 'u9', from: 'user', to: 'admin' } },
    ] });
    const w = await mountPanel();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/security-events', { query: { limit: 100 } });
    const rows = w.findAll('[data-testid="security-log-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('Failed login');
    expect(rows[0]!.text()).toContain('ghost');
    expect(rows[0]!.text()).toContain('192.0.2.10');
    expect(rows[0]!.text()).toContain('unknown user');
    expect(rows[1]!.text()).toContain('Role changed');
    expect(rows[1]!.text()).toContain('user → admin');
  });

  it('says when the log is empty', async () => {
    const w = await mountPanel();
    expect(w.find('[data-testid="security-log-empty"]').text()).toContain('No security events');
  });

  it('shows an error when the log cannot be read, and refreshes on demand', async () => {
    reply = () => { throw new Error('boom'); };
    const w = await mountPanel();
    expect(w.find('[data-testid="security-log-error"]').exists()).toBe(true);
    reply = () => ({ events: [{ id: 1, createdAt: Date.now(), type: 'token_created', ip: null, userId: 'u1', username: 'bob', details: { tokenLabel: 'phone', scope: 'read' } }] });
    await w.find('[data-testid="security-log-refresh"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="security-log-error"]').exists()).toBe(false);
    expect(w.find('[data-testid="security-log-row"]').text()).toContain('API token created');
  });
});
