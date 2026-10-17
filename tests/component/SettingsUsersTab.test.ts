import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import SettingsUsersTab from '../../app/components/settings/SettingsUsersTab.vue';

let fetchMock: ReturnType<typeof vi.fn>;
let users: any[];
let putReply: () => unknown;

const me = { id: 'a1', username: 'boss', role: 'admin', created_at: 1, channelAccess: [] };
const bob = { id: 'u2', username: 'bob', role: 'user', created_at: 2, channelAccess: [] };
const admin2 = { id: 'a2', username: 'admin', role: 'admin', created_at: 3, channelAccess: [] };

beforeEach(() => {
  clearNuxtData();
  useState('auth_loading').value = false;
  useState<any>('auth_user').value = { id: 'a1', username: 'boss', role: 'admin' };
  users = [me, bob];
  putReply = () => ({ success: true });
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/admin/users') return { users };
    if (url === '/api/channels') return { channels: [] };
    if (url === '/api/admin/stats') return {};
    if (url.startsWith('/api/admin/users/') && opts?.method === 'PUT') return putReply();
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountTab = async () => {
  const w = await mountSuspended(SettingsUsersTab);
  await flushPromises();
  return w;
};

const card = (w: any, username: string) =>
  w.findAll('.user-card-premium').find((c: any) => c.find('h4').text() === username)!;

describe('SettingsUsersTab', () => {
  it('disables Delete for yourself and for the last admin', async () => {
    users = [me, bob];
    const w = await mountTab();
    expect(card(w, 'boss').find('[data-testid="user-delete"]').attributes('disabled')).toBeDefined();
    expect(card(w, 'bob').find('[data-testid="user-delete"]').attributes('disabled')).toBeUndefined();
  });

  it('does not protect an account just because it is named "admin"', async () => {
    users = [me, bob, admin2];
    const w = await mountTab();
    expect(card(w, 'admin').find('[data-testid="user-delete"]').attributes('disabled')).toBeUndefined();
  });

  it('disables Delete on the only admin even when it is someone else', async () => {
    useState<any>('auth_user').value = { id: 'zz', username: 'other', role: 'admin' };
    users = [me, bob];
    const w = await mountTab();
    expect(card(w, 'boss').find('[data-testid="user-delete"]').attributes('disabled')).toBeDefined();
  });

  it('hides Reset password for the signed-in admin only', async () => {
    const w = await mountTab();
    expect(card(w, 'boss').find('[data-testid="user-reset-password"]').exists()).toBe(false);
    expect(card(w, 'bob').find('[data-testid="user-reset-password"]').exists()).toBe(true);
  });

  it('never sends a password when editing yourself', async () => {
    const w = await mountTab();
    await card(w, 'boss').findAll('button').find((b: any) => b.text() === 'Edit')!.trigger('click');
    expect(w.find('#u_password').exists()).toBe(false);
    await w.find('form.user-form').trigger('submit');
    await flushPromises();
    const put = fetchMock.mock.calls.find(([u, o]) => u === '/api/admin/users/a1' && o?.method === 'PUT')!;
    expect(put[1].body.password).toBeUndefined();
  });

  it('shows the server message when the update is refused', async () => {
    putReply = () => { throw Object.assign(new Error('x'), { data: { statusMessage: 'You cannot remove your own admin role.' } }); };
    const w = await mountTab();
    await card(w, 'boss').findAll('button').find((b: any) => b.text() === 'Edit')!.trigger('click');
    await w.find('form.user-form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('You cannot remove your own admin role.');
  });

  it('checks a typed password against the length rules before creating', async () => {
    const w = await mountTab();
    await w.find('#u_username').setValue('carol');
    await w.find('#u_password').setValue('short');
    await w.find('form.user-form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('at least 8 characters');
    expect(fetchMock.mock.calls.some(([u, o]) => u === '/api/admin/users' && o?.method === 'POST')).toBe(false);
  });

  it('keeps the success message after saving', async () => {
    const w = await mountTab();
    await card(w, 'bob').findAll('button').find((b: any) => b.text() === 'Edit')!.trigger('click');
    await w.find('form.user-form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('User updated successfully.');
  });
});
