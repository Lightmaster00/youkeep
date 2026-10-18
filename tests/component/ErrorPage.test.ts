import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ErrorPage from '../../app/error.vue';

describe('app/error.vue (#23)', () => {
  it('shows a branded 404 with one message and a way home', async () => {
    const w = await mountSuspended(ErrorPage, { props: { error: { statusCode: 404, statusMessage: 'Page not found: /nope' } } });
    expect(w.find('h1').text()).toBe('Page not found');
    expect(w.text()).toContain('YouKeep');
    expect(w.text()).toContain('Back to Home');
    expect(w.text()).not.toContain('Try again');
  });

  it('offers a retry on a server error', async () => {
    const w = await mountSuspended(ErrorPage, { props: { error: { statusCode: 500 } } });
    expect(w.find('h1').text()).toBe('Something went wrong');
    expect(w.text()).toContain('Try again');
  });
});
