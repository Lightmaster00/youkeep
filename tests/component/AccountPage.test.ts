import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import AccountPage from '../../app/pages/account.vue';
import { passwordProblem } from '../../app/utils/passwordRules';

let fetchMock: ReturnType<typeof vi.fn>;
let passwordReply: () => unknown;

const setUser = (mustChangePassword = false) => {
  useState<any>('auth_user').value = { id: 'u1', username: 'bob', role: 'user', mustChangePassword };
};

beforeEach(() => {
  passwordReply = () => ({ success: true });
  fetchMock = vi.fn(async (url: string, opts?: any) => {
    if (url === '/api/account/profile') return { firstName: '', lastName: '', email: '', phone: '', dob: '' };
    if (url === '/api/account/tokens') return { tokens: [] };
    if (url === '/api/account/password' && opts?.method === 'PUT') return passwordReply();
    if (url === '/api/auth/me') return { user: { id: 'u1', username: 'bob', role: 'user', mustChangePassword: false } };
    return {};
  });
  vi.stubGlobal('$fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const mountPage = async () => {
  const w = await mountSuspended(AccountPage);
  await flushPromises();
  return w;
};

const fill = async (w: any, current: string, next: string, confirm = next) => {
  await w.find('#current_password').setValue(current);
  await w.find('#own_password').setValue(next);
  await w.find('#own_password_confirm').setValue(confirm);
  await w.find('form.password-change-form').trigger('submit');
  await flushPromises();
};

const passwordCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/account/password');

describe('account page password change', () => {
  it('shows a refused new password as a styled alert, a success as a status (#14)', async () => {
    setUser(true);
    passwordReply = () => { throw Object.assign(new Error('x'), { statusCode: 400, data: { statusMessage: 'Choose a different password.' } }); };
    const w = await mountPage();
    await fill(w, 'temp-secret-1', 'temp-secret-1');
    const msg = w.find('[data-testid="password-message"]');
    expect(msg.text()).toBe('Choose a different password.');
    expect(msg.attributes('role')).toBe('alert');
    expect(msg.classes()).toContain('error-msg');
    passwordReply = () => ({ success: true });
    await fill(w, 'temp-secret-1', 'brand-new-secret');
    const ok = w.find('[data-testid="password-message"]');
    expect(ok.attributes('role')).toBe('status');
    expect(ok.classes()).toContain('success-msg');
  });

  it('sends the current password with the new one', async () => {
    setUser();
    const w = await mountPage();
    expect(w.find('label[for="current_password"]').text()).toBe('Current password');
    await fill(w, 'old-secret', 'new-secret-123');
    expect(passwordCalls()).toHaveLength(1);
    expect(passwordCalls()[0]![1].body).toEqual({ currentPassword: 'old-secret', password: 'new-secret-123' });
    expect(w.text()).toContain('changed successfully');
  });

  it('labels the field "Temporary password" for a forced change', async () => {
    setUser(true);
    const w = await mountPage();
    expect(w.find('label[for="current_password"]').text()).toBe('Temporary password');
  });

  it('requires the current password before calling the server', async () => {
    setUser();
    const w = await mountPage();
    await fill(w, '', 'new-secret-123');
    expect(passwordCalls()).toHaveLength(0);
    expect(w.text()).toContain('Enter your current password.');
  });

  it('rejects passwords under 8 characters and over 72 bytes inline', async () => {
    setUser();
    const w = await mountPage();
    await fill(w, 'old-secret', 'short12');
    expect(w.text()).toContain('at least 8 characters');
    await fill(w, 'old-secret', 'é'.repeat(37));
    expect(w.text()).toContain('at most 72 bytes');
    expect(passwordCalls()).toHaveLength(0);
  });

  it('shows the server message on a wrong current password', async () => {
    setUser();
    passwordReply = () => { throw Object.assign(new Error('x'), { data: { statusMessage: 'Current password is incorrect.' } }); };
    const w = await mountPage();
    await fill(w, 'wrong-one', 'new-secret-123');
    expect(w.text()).toContain('Current password is incorrect.');
  });

  it('hides the profile form and skips the token list while a password change is mandatory', async () => {
    setUser(true);
    const w = await mountPage();
    expect(w.find('[data-testid="profile-form"]').exists()).toBe(false);
    expect(w.find('[data-testid="profile-locked"]').exists()).toBe(true);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/account/tokens')).toBe(false);
    expect(w.find('.api-tokens-box').exists()).toBe(false);
    expect(w.text()).not.toContain('API tokens');
  });

  it('shows the API tokens box for a normal session', async () => {
    setUser();
    const w = await mountPage();
    expect(w.find('.api-tokens-box').exists()).toBe(true);
  });

  it('clears all three password fields after a successful change', async () => {
    setUser();
    const w = await mountPage();
    await fill(w, 'old-secret', 'new-secret-123');
    expect(w.text()).toContain('changed successfully');
    expect((w.find('#current_password').element as HTMLInputElement).value).toBe('');
    expect((w.find('#own_password').element as HTMLInputElement).value).toBe('');
    expect((w.find('#own_password_confirm').element as HTMLInputElement).value).toBe('');
  });

  it('keeps the typed current password after a refused change', async () => {
    setUser();
    passwordReply = () => { throw Object.assign(new Error('x'), { data: { statusMessage: 'Current password is incorrect.' } }); };
    const w = await mountPage();
    await fill(w, 'wrong-one', 'new-secret-123');
    expect((w.find('#current_password').element as HTMLInputElement).value).toBe('wrong-one');
  });

  it('shows the profile form for a normal session', async () => {
    setUser();
    const w = await mountPage();
    expect(w.find('[data-testid="profile-form"]').exists()).toBe(true);
  });
});

describe('account page API tokens', () => {
  const DAY = 24 * 60 * 60 * 1000;
  let tokens: any[];
  beforeEach(() => {
    tokens = [];
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, opts?: any) => {
      if (url === '/api/account/tokens' && opts?.method === 'POST') return { id: 'new', label: opts.body.name, token: 'yk_secret_value' };
      if (url === '/api/account/tokens') return { tokens };
      return base(url, opts);
    });
  });

  const createCalls = () => fetchMock.mock.calls.filter(([u, o]) => u === '/api/account/tokens' && o?.method === 'POST');

  it('creates a read-only 90-day token by default and reveals it once', async () => {
    setUser();
    const w = await mountPage();
    expect((w.find('#token_scope').element as HTMLSelectElement).value).toBe('read');
    expect((w.find('#token_expiry').element as HTMLSelectElement).value).toBe('90');
    await w.find('#token_label').setValue('phone');
    await w.find('form.token-create-form').trigger('submit');
    await flushPromises();
    expect(createCalls()[0]![1].body).toEqual({ name: 'phone', scope: 'read', expiresInDays: 90 });
    expect(w.find('.new-token-reveal').text()).toContain('yk_secret_value');
  });

  it('sends full scope and null expiry for "Never"', async () => {
    setUser();
    const w = await mountPage();
    await w.find('#token_label').setValue('script');
    await w.find('#token_scope').setValue('full');
    await w.find('#token_expiry').setValue('never');
    await w.find('form.token-create-form').trigger('submit');
    await flushPromises();
    expect(createCalls()[0]![1].body).toEqual({ name: 'script', scope: 'full', expiresInDays: null });
  });

  it('offers 30 days, 90 days, 1 year and Never', async () => {
    setUser();
    const w = await mountPage();
    const options = w.findAll('#token_expiry option').map((o) => o.text());
    expect(options).toEqual(['30 days', '90 days', '1 year', 'Never']);
    expect(w.findAll('#token_scope option').map((o) => o.text())).toEqual(['Read-only', 'Full access']);
  });

  it('lists scope, expiry and last use', async () => {
    const now = Date.now();
    tokens = [
      { id: 'a', label: 'reader', scope: 'read', createdAt: now, expiresAt: now + 10 * DAY - 1000, lastUsedAt: null },
      { id: 'b', label: 'writer', scope: 'full', createdAt: now, expiresAt: null, lastUsedAt: now },
      { id: 'c', label: 'stale', scope: 'full', createdAt: now - 100 * DAY, expiresAt: now - DAY, lastUsedAt: null },
    ];
    setUser();
    const w = await mountPage();
    const rows = w.findAll('.api-token-row');
    expect(rows[0]!.find('.api-token-scope').text()).toBe('Read-only');
    expect(rows[0]!.text()).toContain('Expires in 10 days');
    expect(rows[0]!.text()).toContain('Never used');
    expect(rows[1]!.find('.api-token-scope').text()).toBe('Full access');
    expect(rows[1]!.text()).toContain('Never expires');
    expect(rows[1]!.text()).toContain('Last used');
    expect(rows[2]!.text()).toContain('Expired');
  });
});

describe('passwordProblem', () => {
  it('counts characters, not UTF-16 units, for the minimum', () => {
    expect(passwordProblem('😀😀😀😀😀😀😀😀')).toBeNull();
    expect(passwordProblem('😀😀😀😀😀😀😀')).toMatch(/at least 8/);
  });
  it('counts UTF-8 bytes for the maximum', () => {
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('a'.repeat(73))).toMatch(/72 bytes/);
    expect(passwordProblem('é'.repeat(36))).toBeNull();
    expect(passwordProblem('é'.repeat(37))).toMatch(/72 bytes/);
  });
});
